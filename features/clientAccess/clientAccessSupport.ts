import { Linking } from 'react-native';
import { config } from '../../constants/config';

export async function openClientAccessSupport(): Promise<void> {
  await Linking.openURL(config.urls.support);
}
