import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const APPROVED_SLUGS = new Set(['healthy-recipes', 'clinic-guide']);
const DYNAMIC_AASA_COMPONENTS = Object.freeze([
  Object.freeze({ '/': '/apps/client-resources/launch/', exclude: true }),
  Object.freeze({ '/': '/apps/client-resources/launch/*', exclude: true }),
  Object.freeze({ '/': '/apps/client-resources/api/', exclude: true }),
  Object.freeze({ '/': '/apps/client-resources/api/*', exclude: true }),
  Object.freeze({ '/': '/apps/app-review/', exclude: true }),
  Object.freeze({ '/': '/apps/app-review/*', exclude: true }),
  Object.freeze({ '/': '/apps/client-resources/' }),
  Object.freeze({ '/': '/apps/client-resources/*', exclude: true }),
  Object.freeze({ '/': '/apps/*/' }),
]);
const SOURCE_AASA_PATH = 'web-hosting/cabohealth.org/.well-known/apple-app-site-association';
const APP_STORE_AGE_RATINGS = new Set([4, 9, 13, 16, 18]);
const SOURCE_DIRECTORIES = ['app', 'components', 'constants', 'context', 'hooks', 'features'];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const LEGAL_URLS = {
  Privacy: 'https://cabohealth.org/app/privacy/',
  Terms: 'https://cabohealth.org/app/terms/',
  Support: 'https://cabohealth.org/app/support/',
  'Report Content': 'https://cabohealth.org/app/report-content/',
};
const LEGAL_SURFACE_PATHS = {
  Privacy: 'web-hosting/cabohealth.org/app/privacy/index.html',
  Terms: 'web-hosting/cabohealth.org/app/terms/index.html',
  Support: 'web-hosting/cabohealth.org/app/support/index.html',
  'Report Content': 'web-hosting/cabohealth.org/app/report-content/index.html',
};
const REQUIRED_COMPLIANCE_GATES = [
  'appStore.seller',
  'appStore.sellerRelationship',
  'hosting.logTypes',
  'hosting.retention',
  'hosting.deletionProcess',
  'support.responseSla',
  'contentRights',
  'exportCompliance',
  'medicalDevice',
  'ageRating.host',
  'ageRating.miniapps.healthy-recipes',
  'ageRating.miniapps.clinic-guide',
  'phiRemediation',
];

function walk(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.')));
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function addUnexpectedSlugs(errors, source, slugs) {
  for (const slug of slugs) {
    if (!APPROVED_SLUGS.has(slug)) {
      errors.push(`Unapproved miniapp slug in ${source}: ${slug}`);
    }
  }
}

function extractCatalogSlugs(source) {
  const canonicalList = source.match(/\bPUBLIC_MINIAPP_SLUGS\s*=\s*\[([^\]]*)\]/);
  return canonicalList
    ? [...canonicalList[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((match) => match[1])
    : [];
}

function validateDynamicAasaAuthority(source, errors) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    errors.push('Invalid dynamic AASA authority: JSON');
    return;
  }
  const details = value?.applinks?.details;
  const components = Array.isArray(details) && details.length === 1
    ? details[0]?.components
    : undefined;
  if (JSON.stringify(components) !== JSON.stringify(DYNAMIC_AASA_COMPONENTS)) {
    errors.push('Invalid dynamic AASA authority: protected exclusions or canonical-root include changed');
  }
}

function isSlugBearingKey(key) {
  if (/^legal[-_]?slugs?$/i.test(key)) return false;
  return /^miniapps?$/i.test(key)
    || /(?:^|[-_])slugs?$/i.test(key)
    || /(?:Slug|Slugs)$/.test(key);
}

function collectMetadataSlugs(value, slugs, key = '') {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMetadataSlugs(item, slugs, key);
    }
  } else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectMetadataSlugs(childValue, slugs, childKey);
    }
  } else if (typeof value === 'string') {
    if (isSlugBearingKey(key) && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value)) {
      slugs.push(value);
    }
    for (const match of value.matchAll(/\/apps\/([a-z0-9-]+)\/(?:\*|(?=["'}\],\s]|$))/g)) {
      slugs.push(match[1]);
    }
  }
}

function hasForbiddenUrlScheme(source) {
  const literals = [];
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === '/' && next === '/') {
      index = source.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (current === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (current !== "'" && current !== '"' && current !== '`') {
      index += 1;
      continue;
    }

    const quote = current;
    let literal = '';
    index += 1;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\' && index + 1 < source.length) {
        literal += source[index + 1];
        index += 2;
      } else {
        literal += source[index];
        index += 1;
      }
    }
    if (source[index] === quote) {
      literals.push(literal);
      index += 1;
    }
  }

  return literals.some((literal) => /^\s*(?:javascript|data|file|content|intent):/i.test(literal));
}

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, path, expectedKeys, errors) {
  if (!isPlainRecord(value)) {
    errors.push(`Invalid compliance schema at ${path}: expected object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    errors.push(`Invalid compliance schema at ${path}: expected only ${expected.join(', ')}`);
    return false;
  }
  return true;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function describedValue(value, path, errors) {
  return hasExactKeys(value, `${path}.value`, ['description'], errors)
    && isNonEmptyString(value.description);
}

function approvedScopedValue(value, path, errors) {
  return hasExactKeys(value, `${path}.value`, ['approved', 'scope'], errors)
    && value.approved === true
    && isNonEmptyString(value.scope);
}

function approvedDeterminationValue(value, path, errors) {
  return hasExactKeys(value, `${path}.value`, ['approved', 'determination'], errors)
    && value.approved === true
    && isNonEmptyString(value.determination);
}

function individualSellerValue(value, path, errors) {
  return hasExactKeys(value, `${path}.value`, ['legalSeller', 'sellerType'], errors)
    && value.sellerType === 'individual'
    && value.legalSeller === 'Ivan Guaderrama';
}

function tradeBrandRelationshipValue(value, path, errors) {
  return hasExactKeys(
    value,
    `${path}.value`,
    ['brandIsSeparateLegalEntity', 'publicBrand', 'relationship'],
    errors,
  )
    && value.publicBrand === 'Cabo Health'
    && value.brandIsSeparateLegalEntity === false
    && value.relationship === 'trade brand owned and operated by Ivan Guaderrama';
}

function medicalDeviceValue(value, path, errors) {
  return hasExactKeys(value, `${path}.value`, ['basis', 'isMedicalDevice'], errors)
    && typeof value.isMedicalDevice === 'boolean'
    && isNonEmptyString(value.basis);
}

function phiRemediationValue(value, path, errors) {
  return hasExactKeys(value, `${path}.value`, ['completed', 'evidenceRef'], errors)
    && value.completed === true
    && isNonEmptyString(value.evidenceRef);
}

function ageRatingValue(value) {
  return APP_STORE_AGE_RATINGS.has(value);
}

function validateGate(gate, path, valueValidator, errors) {
  if (!hasExactKeys(gate, path, ['status', 'value'], errors)) return;
  if (gate.status === 'pending') {
    if (gate.value !== null) {
      errors.push(`Invalid compliance gate at ${path}: pending gate must have null value`);
    }
    return;
  }
  if (gate.status !== 'verified') {
    errors.push(`Invalid compliance gate at ${path}: status must be pending or verified`);
    return;
  }
  if (!valueValidator(gate.value, path, errors)) {
    errors.push(`Invalid verified compliance value at ${path}`);
  }
}

function staticBindings(sourceFile) {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        bindings.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return bindings;
}

function addBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBindingNames(element.name, names);
  }
}

function topLevelRuntimeBindings(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addBindingNames(declaration.name, names);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement)
        || ts.isModuleDeclaration(statement))
      && statement.name
      && ts.isIdentifier(statement.name)
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text);
      continue;
    }
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      if (statement.importClause.name) names.add(statement.importClause.name.text);
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        names.add(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) names.add(element.name.text);
      }
    }
  }
  return names;
}

function isStaticWrapperExpression(expression) {
  return ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isSatisfiesExpression(expression)
    || ts.isNonNullExpression(expression);
}

function isGlobalObjectFreezeCall(expression, bindings) {
  return ts.isCallExpression(expression)
    && expression.arguments.length === 1
    && ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === 'Object'
    && expression.expression.name.text === 'freeze'
    && !bindings.has('Object');
}

function resolveStaticReference(expression, bindings, visited) {
  let current = expression;
  while (current) {
    if (isStaticWrapperExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isIdentifier(current)) {
      if (visited.has(current.text) || !bindings.has(current.text)) return undefined;
      visited.add(current.text);
      current = bindings.get(current.text);
      continue;
    }
    return current;
  }
  return undefined;
}

function isDeclarativeCatalogExpression(expression, bindings, seen = new Set()) {
  let current = expression;
  while (isStaticWrapperExpression(current)) current = current.expression;

  if (
    current.kind === ts.SyntaxKind.NullKeyword
    || current.kind === ts.SyntaxKind.TrueKeyword
    || current.kind === ts.SyntaxKind.FalseKeyword
    || ts.isStringLiteral(current)
    || ts.isNoSubstitutionTemplateLiteral(current)
    || ts.isNumericLiteral(current)
  ) {
    return true;
  }
  if (
    ts.isPrefixUnaryExpression(current)
    && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(current.operator)
    && ts.isNumericLiteral(current.operand)
  ) {
    return true;
  }
  if (ts.isIdentifier(current)) {
    if (seen.has(current.text) || !bindings.has(current.text)) return false;
    const visited = new Set(seen);
    visited.add(current.text);
    return isDeclarativeCatalogExpression(bindings.get(current.text), bindings, visited);
  }
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.every((element) => !ts.isSpreadElement(element)
      && isDeclarativeCatalogExpression(element, bindings, new Set(seen)));
  }
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.every((property) => ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name)
      && isDeclarativeCatalogExpression(property.initializer, bindings, new Set(seen)));
  }
  if (isGlobalObjectFreezeCall(current, bindings)) {
    return isDeclarativeCatalogExpression(current.arguments[0], bindings, new Set(seen));
  }
  return false;
}

function isDeclarativeCatalogModule(sourceFile, bindings) {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) return false;
      if (statement.declarationList.declarations.some((declaration) => (
        !declaration.initializer
        || !isDeclarativeCatalogExpression(declaration.initializer, bindings)
      ))) return false;
      continue;
    }
    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
      || ts.isEmptyStatement(statement)
    ) {
      continue;
    }
    if (
      ts.isExpressionStatement(statement)
      && ts.isVoidExpression(statement.expression)
      && ts.isIdentifier(statement.expression.expression)
      && bindings.has(statement.expression.expression.text)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function unwrapStaticExpression(expression, bindings, seen = new Set()) {
  const visited = new Set(seen);
  let current = expression;
  while (current) {
    current = resolveStaticReference(current, bindings, visited);
    if (!current) return undefined;
    if (isGlobalObjectFreezeCall(current, bindings)) {
      current = current.arguments[0];
      continue;
    }
    return current;
  }
  return undefined;
}

function frozenStaticArgument(expression, bindings) {
  const resolved = resolveStaticReference(expression, bindings, new Set());
  return resolved && isGlobalObjectFreezeCall(resolved, bindings)
    ? resolved.arguments[0]
    : undefined;
}

function staticPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function readStaticScalar(expression, bindings) {
  const resolved = unwrapStaticExpression(expression, bindings);
  if (!resolved) return { ok: false };
  if (resolved.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isStringLiteral(resolved) || ts.isNoSubstitutionTemplateLiteral(resolved)) {
    return { ok: true, value: resolved.text };
  }
  if (ts.isNumericLiteral(resolved)) return { ok: true, value: Number(resolved.text) };
  if (
    ts.isPrefixUnaryExpression(resolved)
    && resolved.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(resolved.operand)
  ) {
    return { ok: true, value: -Number(resolved.operand.text) };
  }
  return { ok: false };
}

function exportedPublicMiniappInitializer(sourceFile) {
  const initializers = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'PUBLIC_MINIAPPS') {
        initializers.push(declaration.initializer);
      }
    }
  }
  return initializers;
}

function readExportedPublicMiniapps(source, errors) {
  const sourceFile = ts.createSourceFile('publicMiniapps.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sourceFile.parseDiagnostics ?? []).length > 0) {
    errors.push('Invalid TypeScript syntax in constants/publicMiniapps.ts');
    return [];
  }
  if (topLevelRuntimeBindings(sourceFile).has('Object')) {
    errors.push('PUBLIC_MINIAPPS must not shadow the global Object.freeze intrinsic');
    return [];
  }
  const bindings = staticBindings(sourceFile);
  if (!isDeclarativeCatalogModule(sourceFile, bindings)) {
    errors.push('Catalog module must be side-effect-free declarative const data');
    return [];
  }
  const initializers = exportedPublicMiniappInitializer(sourceFile);
  if (initializers.length !== 1 || !initializers[0]) {
    errors.push('Catalog must export exactly one initialized PUBLIC_MINIAPPS constant');
    return [];
  }
  const frozenArray = frozenStaticArgument(initializers[0], bindings);
  const array = frozenArray && unwrapStaticExpression(frozenArray, bindings);
  if (!array || !ts.isArrayLiteralExpression(array)) {
    errors.push('PUBLIC_MINIAPPS must resolve statically to an Object.freeze array literal');
    return [];
  }

  const entries = [];
  for (const [index, element] of array.elements.entries()) {
    if (ts.isSpreadElement(element)) {
      errors.push(`PUBLIC_MINIAPPS[${index}] must not use spread syntax`);
      continue;
    }
    const frozenObject = frozenStaticArgument(element, bindings);
    const object = frozenObject && unwrapStaticExpression(frozenObject, bindings);
    if (!object || !ts.isObjectLiteralExpression(object)) {
      errors.push(`PUBLIC_MINIAPPS[${index}] must resolve statically to an Object.freeze object literal`);
      continue;
    }
    if (object.properties.some((property) => ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name)))) {
      errors.push(`PUBLIC_MINIAPPS[${index}] must not use spread or computed properties`);
      continue;
    }

    const property = (name) => object.properties.filter((candidate) => candidate.name && staticPropertyName(candidate.name) === name);
    const slugProperties = property('slug');
    const ratingProperties = property('appStoreAgeRating');
    if (
      slugProperties.length !== 1
      || ratingProperties.length !== 1
      || !ts.isPropertyAssignment(slugProperties[0])
      || !ts.isPropertyAssignment(ratingProperties[0])
    ) {
      errors.push(`PUBLIC_MINIAPPS[${index}] must have one static slug and appStoreAgeRating`);
      continue;
    }
    const slug = readStaticScalar(slugProperties[0].initializer, bindings);
    const rating = readStaticScalar(ratingProperties[0].initializer, bindings);
    if (!slug.ok || typeof slug.value !== 'string' || !rating.ok || (rating.value !== null && typeof rating.value !== 'number')) {
      errors.push(`PUBLIC_MINIAPPS[${index}] has a non-static slug or appStoreAgeRating`);
      continue;
    }
    entries.push({ slug: slug.value, rating: rating.value });
  }
  return entries;
}

function verifyComplianceFactsValue(facts, errors, catalogRatings) {
  hasExactKeys(facts, 'compliance', [
    'schemaVersion',
    'brand',
    'releaseReady',
    'slice',
    'legalEntity',
    'appStore',
    'hosting',
    'support',
    'contentRights',
    'exportCompliance',
    'medicalDevice',
    'ageRating',
    'phiRemediation',
  ], errors);
  if (facts.schemaVersion !== 1) errors.push('Invalid compliance schemaVersion: expected 1');
  if (facts.brand !== 'Cabo Health') errors.push('Invalid compliance brand: expected Cabo Health');
  if (typeof facts.releaseReady !== 'boolean') errors.push('Invalid compliance releaseReady: expected boolean');
  if (!isNonEmptyString(facts.slice)) errors.push('Invalid compliance slice: expected non-empty string');

  if (hasExactKeys(facts.legalEntity, 'legalEntity', [
    'dunsApplicable',
    'dunsNumber',
    'legalSignOffStatus',
    'name',
    'nameStatus',
    'registeredOrganization',
    'sellerType',
  ], errors)) {
    if (facts.legalEntity.name !== 'Ivan Guaderrama') {
      errors.push('Invalid legalEntity.name: expected Ivan Guaderrama');
    }
    if (facts.legalEntity.nameStatus !== 'owner-confirmed') {
      errors.push('Invalid legalEntity.nameStatus: expected owner-confirmed');
    }
    if (facts.legalEntity.sellerType !== 'individual') {
      errors.push('Invalid legalEntity.sellerType: expected individual');
    }
    if (facts.legalEntity.registeredOrganization !== false) {
      errors.push('Invalid legalEntity.registeredOrganization: expected false');
    }
    if (facts.legalEntity.dunsApplicable !== false || facts.legalEntity.dunsNumber !== null) {
      errors.push('Invalid legalEntity D-U-N-S facts: not applicable and no number required');
    }
    if (!['pending', 'approved'].includes(facts.legalEntity.legalSignOffStatus)) {
      errors.push('Invalid legalEntity.legalSignOffStatus');
    }
  }

  hasExactKeys(facts.appStore, 'appStore', ['seller', 'sellerRelationship'], errors);
  hasExactKeys(facts.hosting, 'hosting', ['deletionProcess', 'logTypes', 'provider', 'retention'], errors);
  if (facts.hosting?.provider !== 'Hostinger') errors.push('Invalid hosting.provider: expected Hostinger');
  hasExactKeys(facts.support, 'support', ['contactFactsRef', 'responseSla'], errors);
  if (facts.support?.contactFactsRef !== 'release/public-contact-facts.json') {
    errors.push('Invalid support.contactFactsRef');
  }
  hasExactKeys(facts.ageRating, 'ageRating', ['host', 'miniapps'], errors);
  hasExactKeys(facts.ageRating?.miniapps, 'ageRating.miniapps', ['clinic-guide', 'healthy-recipes'], errors);

  validateGate(facts.appStore?.seller, 'appStore.seller', individualSellerValue, errors);
  validateGate(
    facts.appStore?.sellerRelationship,
    'appStore.sellerRelationship',
    tradeBrandRelationshipValue,
    errors,
  );
  validateGate(
    facts.hosting?.logTypes,
    'hosting.logTypes',
    (value) => Array.isArray(value)
      && value.length > 0
      && value.every(isNonEmptyString)
      && new Set(value).size === value.length,
    errors,
  );
  validateGate(facts.hosting?.retention, 'hosting.retention', describedValue, errors);
  validateGate(facts.hosting?.deletionProcess, 'hosting.deletionProcess', describedValue, errors);
  validateGate(facts.support?.responseSla, 'support.responseSla', describedValue, errors);
  validateGate(facts.contentRights, 'contentRights', approvedScopedValue, errors);
  validateGate(facts.exportCompliance, 'exportCompliance', approvedDeterminationValue, errors);
  validateGate(facts.medicalDevice, 'medicalDevice', medicalDeviceValue, errors);
  validateGate(facts.ageRating?.host, 'ageRating.host', ageRatingValue, errors);
  validateGate(facts.ageRating?.miniapps?.['healthy-recipes'], 'ageRating.miniapps.healthy-recipes', ageRatingValue, errors);
  validateGate(facts.ageRating?.miniapps?.['clinic-guide'], 'ageRating.miniapps.clinic-guide', ageRatingValue, errors);
  validateGate(facts.phiRemediation, 'phiRemediation', phiRemediationValue, errors);

  if (facts.legalEntity?.legalSignOffStatus !== 'approved') {
    errors.push('Pending release gate: legalEntity.legalSignOffStatus');
  }

  for (const path of REQUIRED_COMPLIANCE_GATES) {
    const gate = valueAtPath(facts, path);
    if (gate?.status !== 'verified' || gate.value === null || gate.value === undefined) {
      errors.push(`Pending release gate: ${path}`);
    }
  }

  const hostRating = facts.ageRating?.host?.value;
  if (catalogRatings.length !== APPROVED_SLUGS.size) {
    errors.push('Catalog must contain exactly two age-rating entries');
  }
  for (const slug of APPROVED_SLUGS) {
    const frozenRating = facts.ageRating?.miniapps?.[slug]?.value;
    const matchingCatalogRatings = catalogRatings.filter((entry) => entry.slug === slug);
    if (matchingCatalogRatings.length !== 1) {
      errors.push(`Catalog must contain exactly one age rating for: ${slug}`);
    }
    const sourceRating = matchingCatalogRatings[0]?.rating;
    if (Number.isInteger(frozenRating) && Number.isInteger(hostRating) && frozenRating > hostRating) {
      errors.push(`Miniapp age rating exceeds host rating: ${slug}`);
    }
    if (Number.isInteger(frozenRating) && sourceRating !== frozenRating) {
      errors.push(`Catalog age rating does not match compliance facts: ${slug}`);
    }
  }

  if (
    facts.appStore?.seller?.status === 'verified'
    && facts.appStore.seller.value?.legalSeller !== facts.legalEntity?.name
  ) {
    errors.push('App Store legal seller must match Ivan Guaderrama');
  }
  if (
    facts.appStore?.sellerRelationship?.status === 'verified'
    && facts.appStore.sellerRelationship.value?.brandIsSeparateLegalEntity !== false
  ) {
    errors.push('Cabo Health brand must not be a separate legal entity');
  }

  if (facts.releaseReady !== true) {
    errors.push('Release compliance facts are not marked ready');
  }
}

function verifyComplianceFacts(root, errors, catalogRatings) {
  const compliancePath = join(root, 'release', 'compliance-facts.json');
  if (!existsSync(compliancePath)) {
    errors.push('Missing release compliance facts: release/compliance-facts.json');
    return;
  }

  let facts;
  try {
    facts = JSON.parse(readText(compliancePath));
  } catch {
    errors.push('Invalid release metadata JSON: release/compliance-facts.json');
    return;
  }
  verifyComplianceFactsValue(facts, errors, catalogRatings);
}

export function verifyCapturedMinimalV1(files) {
  if (!(files instanceof Map) || [...files].some(([path, bytes]) => typeof path !== 'string' || !Buffer.isBuffer(bytes))) {
    throw new Error('CAPTURED_COMPLIANCE_INPUT_INVALID');
  }
  const errors = [];
  const paths = [...files.keys()];
  const textFor = (path) => files.get(path)?.toString('utf8');
  for (const path of paths) {
    if (path.startsWith('app/(auth)/')) errors.push(`Legacy auth route is still packaged: ${path}`);
  }
  if (files.has('app/(main)/admin.tsx')) errors.push('Admin route is still packaged: app/(main)/admin.tsx');

  const scopedSourcePaths = paths.filter((path) => (
    SOURCE_DIRECTORIES.some((directory) => path.startsWith(`${directory}/`))
    && isSourceFile(path)
  ));
  const sourceText = scopedSourcePaths.map((path) => ({ path, text: textFor(path) }));
  for (const { path, text } of sourceText) {
    const imports = text.match(/\bimport(?:[\s\S]{0,500}?\sfrom\s*)?['"][^'"]+['"]/g) ?? [];
    if (imports.some((statement) => /(?:access[-_ ]?code|biometr\w*|firebase|firestore)/i.test(statement))) {
      errors.push(`Legacy access-code, biometry, Firebase, or Firestore import is reachable from ${path}`);
    }
    if (/\b(?:onMessage|injectedJavaScript)\b/.test(text)) errors.push(`Forbidden WebView bridge control in ${path}`);
    if (/\bEXPO_PUBLIC_[A-Z0-9_]*URL\b/.test(text)) errors.push(`Arbitrary EXPO_PUBLIC_*URL endpoint in ${path}`);
    if (/http:\/\//i.test(text)) errors.push(`Insecure production URL in ${path}`);
    if (hasForbiddenUrlScheme(text)) errors.push(`Forbidden URL scheme in ${path}`);
  }

  let catalogRatings = [];
  const catalogSource = textFor('constants/publicMiniapps.ts');
  if (catalogSource !== undefined) {
    catalogRatings = readExportedPublicMiniapps(catalogSource, errors);
    addUnexpectedSlugs(errors, 'catalog', [
      ...extractCatalogSlugs(catalogSource),
      ...catalogRatings.map((entry) => entry.slug),
    ]);
  } else {
    errors.push('Missing catalog: constants/publicMiniapps.ts');
  }

  const capturedAasa = textFor(SOURCE_AASA_PATH);
  if (capturedAasa === undefined) errors.push(`Missing AASA authority: ${SOURCE_AASA_PATH}`);
  else validateDynamicAasaAuthority(capturedAasa, errors);
  for (const path of paths.filter((path) => (
    (path.startsWith('release/') || path.startsWith('miniapps/')) && path.endsWith('.json')
  ))) {
    try {
      const slugs = [];
      collectMetadataSlugs(JSON.parse(textFor(path)), slugs);
      addUnexpectedSlugs(errors, 'release metadata', slugs);
    } catch {
      errors.push(`Invalid release metadata JSON: ${path}`);
    }
  }

  const packagedText = sourceText.map(({ text }) => text).join('\n');
  for (const [label, url] of Object.entries(LEGAL_URLS)) {
    if (!packagedText.includes(url)) errors.push(`Missing legal URL: ${label}`);
    if (!files.has(LEGAL_SURFACE_PATHS[label])) errors.push(`Missing hosted legal surface: ${label}`);
  }
  const complianceText = textFor('release/compliance-facts.json');
  if (complianceText === undefined) {
    errors.push('Missing release compliance facts: release/compliance-facts.json');
  } else {
    try {
      verifyComplianceFactsValue(JSON.parse(complianceText), errors, catalogRatings);
    } catch {
      errors.push('Invalid release metadata JSON: release/compliance-facts.json');
    }
  }
  return errors;
}

function verify(root) {
  const errors = [];
  const appRoot = join(root, 'app');
  const authRoot = join(appRoot, '(auth)');
  const adminRoute = join(appRoot, '(main)', 'admin.tsx');

  for (const route of walk(authRoot)) {
    errors.push(`Legacy auth route is still packaged: ${relative(root, route)}`);
  }
  if (existsSync(adminRoute)) {
    errors.push(`Admin route is still packaged: ${relative(root, adminRoute)}`);
  }

  const scopedSourceFiles = SOURCE_DIRECTORIES
    .flatMap((directory) => walk(join(root, directory)))
    .filter(isSourceFile);
  const sourceText = scopedSourceFiles.map((filePath) => ({ filePath, text: readText(filePath) }));

  for (const { filePath, text } of sourceText) {
    const location = relative(root, filePath);
    const imports = text.match(/\bimport(?:[\s\S]{0,500}?\sfrom\s*)?['"][^'"]+['"]/g) ?? [];
    if (imports.some((statement) => /(?:access[-_ ]?code|biometr\w*|firebase|firestore)/i.test(statement))) {
      errors.push(`Legacy access-code, biometry, Firebase, or Firestore import is reachable from ${location}`);
    }
    if (/\b(?:onMessage|injectedJavaScript)\b/.test(text)) {
      errors.push(`Forbidden WebView bridge control in ${location}`);
    }
    if (/\bEXPO_PUBLIC_[A-Z0-9_]*URL\b/.test(text)) {
      errors.push(`Arbitrary EXPO_PUBLIC_*URL endpoint in ${location}`);
    }
    if (/http:\/\//i.test(text)) {
      errors.push(`Insecure production URL in ${location}`);
    }
    if (hasForbiddenUrlScheme(text)) {
      errors.push(`Forbidden URL scheme in ${location}`);
    }
  }

  let catalogRatings = [];
  const catalogPath = join(root, 'constants', 'publicMiniapps.ts');
  if (existsSync(catalogPath)) {
    const catalogSource = readText(catalogPath);
    catalogRatings = readExportedPublicMiniapps(catalogSource, errors);
    addUnexpectedSlugs(errors, 'catalog', [
      ...extractCatalogSlugs(catalogSource),
      ...catalogRatings.map((entry) => entry.slug),
    ]);
  } else {
    errors.push('Missing catalog: constants/publicMiniapps.ts');
  }

  const aasaPath = join(root, SOURCE_AASA_PATH);
  if (!existsSync(aasaPath)) errors.push(`Missing AASA authority: ${SOURCE_AASA_PATH}`);
  else validateDynamicAasaAuthority(readText(aasaPath), errors);

  for (const metadataDirectory of ['release', 'miniapps']) {
    for (const metadataPath of walk(join(root, metadataDirectory)).filter((filePath) => filePath.endsWith('.json'))) {
      try {
        const slugs = [];
        collectMetadataSlugs(JSON.parse(readText(metadataPath)), slugs);
        addUnexpectedSlugs(errors, 'release metadata', slugs);
      } catch {
        errors.push(`Invalid release metadata JSON: ${relative(root, metadataPath)}`);
      }
    }
  }

  const packagedText = sourceText.map(({ text }) => text).join('\n');
  for (const [label, url] of Object.entries(LEGAL_URLS)) {
    if (!packagedText.includes(url)) {
      errors.push(`Missing legal URL: ${label}`);
    }
    const surfacePath = join(root, LEGAL_SURFACE_PATHS[label]);
    if (!existsSync(surfacePath) || !statSync(surfacePath).isFile()) {
      errors.push(`Missing hosted legal surface: ${label}`);
    }
  }

  verifyComplianceFacts(root, errors, catalogRatings);

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? process.cwd());
  if (!statSync(root).isDirectory()) {
    throw new Error(`Verification root is not a directory: ${root}`);
  }

  const errors = verify(root);
  if (errors.length > 0) {
    console.error(errors.map((error) => `FAIL: ${error}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Minimal public v1 release scope verified.');
  }
}
