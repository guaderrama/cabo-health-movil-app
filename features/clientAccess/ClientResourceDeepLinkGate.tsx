import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BrandedBackground } from '../../components';
import { useTheme } from '../../hooks';
import { ClientAccessFolio } from './ClientAccessFolio';
import { ClientAccessModal } from './ClientAccessModal';
import { buildClientResourceRoute } from './clientResourceRoute';

export function ClientResourceDeepLinkGate() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const [visible, setVisible] = useState(true);

  const close = () => {
    setVisible(false);
    router.replace('/(main)');
  };

  const openResource = (resourceId: string) => {
    setVisible(false);
    router.replace(buildClientResourceRoute(resourceId));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <BrandedBackground density="rich" moleculeOpacity={isDark ? 0.58 : 0.9} />
      <View pointerEvents={visible ? 'none' : 'auto'} style={styles.folio}>
        <ClientAccessFolio onPress={() => setVisible(true)} />
      </View>
      <ClientAccessModal visible={visible} onClose={close} onOpenResource={openResource} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  folio: { width: '100%', maxWidth: 460, alignSelf: 'center' },
});
