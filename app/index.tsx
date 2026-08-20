import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { IntroScreen } from '../features/onboarding/IntroScreen';

export default function Index() {
  const router = useRouter();
  const completionRef = useRef<Promise<void> | null>(null);

  const completeIntro = useCallback(() => {
    if (!completionRef.current) {
      completionRef.current = Promise.resolve().then(() => {
        router.replace('/(main)');
      });
    }
    return completionRef.current;
  }, [router]);

  return <IntroScreen onComplete={completeIntro} />;
}
