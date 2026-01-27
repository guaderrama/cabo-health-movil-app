# CaboHealth - Production Deployment Checklist

## Pre-Deployment Status

### Code Quality ✅
- [x] Deep audit completed
- [x] All critical bugs fixed
- [x] Security vulnerabilities addressed
- [x] Memory leaks prevented
- [x] Type safety validated

### Assets ✅
- [x] `icon.png` (1024x1024) - App Store icon
- [x] `adaptive-icon.png` - Android adaptive icon
- [x] `splash.png` / `logo.png` - Splash screen
- [x] `favicon.png` - Web favicon

---

## Configuration Steps

### 1. EAS Project Setup

```bash
# Login to Expo
npx eas login

# Initialize EAS project (if not done)
npx eas init

# This will give you a project ID to add to app.json
```

**After running `eas init`, update app.json:**
```json
"extra": {
  "eas": {
    "projectId": "YOUR_ACTUAL_PROJECT_ID"
  }
}
```

### 2. Apple Developer Account Setup

Update `eas.json` with your Apple credentials:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "your-apple-id@email.com",
      "ascAppId": "123456789",  // App Store Connect App ID
      "appleTeamId": "XXXXXXXXXX"  // 10-character Team ID
    }
  }
}
```

**To find these values:**
- `appleId`: Your Apple ID email
- `ascAppId`: App Store Connect > Your App > General > App Information > Apple ID
- `appleTeamId`: Apple Developer Portal > Membership > Team ID

### 3. Firebase Security Rules

Go to Firebase Console > Firestore > Rules and set:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Web Apps - read only
    match /cabohealth_apps/{document=**} {
      allow read: if true;
      allow write: if false;
    }

    // Access Codes - read only for validation
    match /access_codes/{document=**} {
      allow read: if true;
      allow write: if false;
    }

    // Config - read only
    match /cabohealth_config/{document=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

### 4. App Store Information

Prepare these for App Store Connect:

| Field | Value |
|-------|-------|
| **App Name** | CaboHealth |
| **Bundle ID** | com.cabohealth.app |
| **SKU** | cabohealth-ios-2024 |
| **Primary Language** | English |
| **Category** | Health & Fitness |
| **Age Rating** | 4+ |

**Screenshots needed:**
- iPhone 6.7" (1290 x 2796) - iPhone 15 Pro Max
- iPhone 6.5" (1284 x 2778) - iPhone 14 Plus
- iPhone 5.5" (1242 x 2208) - iPhone 8 Plus

**App Description:**
```
CaboHealth - Your gateway to premium health and longevity services in Los Cabos.

Access exclusive health apps and services curated for our clients. Features include:
- Quick access to health apps
- Favorites management
- Biometric security (Face ID / Touch ID)
- Offline mode support
- Dark mode support

This app requires an access code provided by your CaboHealth service provider.
```

**Keywords:**
```
health, wellness, longevity, cabo, medical, services
```

---

## Build Commands

### Development Build
```bash
# Build for iOS simulator (testing)
npx eas build --platform ios --profile development
```

### Preview Build (TestFlight internal)
```bash
# Build for internal testing
npx eas build --platform ios --profile preview
```

### Production Build
```bash
# Build for App Store
npx eas build --platform ios --profile production
```

### Submit to App Store
```bash
# Submit latest build
npx eas submit --platform ios --latest
```

---

## Pre-Build Checklist

- [ ] Run type check: `npm run typecheck`
- [ ] Test on iOS simulator
- [ ] Verify Firebase connection works
- [ ] Test access code validation flow
- [ ] Test biometry authentication
- [ ] Test WebView loading
- [ ] Test favorites functionality
- [ ] Verify admin panel access works
- [ ] Check error handling screens

---

## Post-Submission Checklist

- [ ] App uploaded to App Store Connect
- [ ] Add screenshots for all device sizes
- [ ] Fill in App Privacy details
- [ ] Set up App Store pricing (Free)
- [ ] Submit for review
- [ ] Monitor review status

---

## Environment Summary

| Item | Status |
|------|--------|
| Expo SDK | 54 |
| React Native | 0.81.5 |
| Firebase Project | instalacionmariposas |
| Bundle ID | com.cabohealth.app |
| App Version | 2.0.0 |
| Build Number | 1 |

---

## Quick Commands Reference

```bash
# Start development
npm start

# Type check
npm run typecheck

# Build for production
npm run build:prod

# Submit to App Store
npm run submit

# OTA update (after first publish)
npm run update
```

---

## Support

- **Admin Access**: 5 taps on Support button + PIN `1234`
- **Master Admin Code**: `CABO-ADMIN2024`
- **Support Email**: ivan@ivanguaderrama.com
