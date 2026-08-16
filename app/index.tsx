import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { IntroScreen } from '../features/onboarding/IntroScreen';
import { shouldShowIntro } from '../features/onboarding/introTiming';
import { getOnboardingCompleted, setOnboardingCompleted } from '../services/storage';

export default function Index() {
  const router = useRouter();
  const { replay } = useLocalSearchParams<{ replay?: string | string[] }>();
  const [showIntro, setShowIntro] = useState<boolean | null>(null);
  const completionRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let mounted = true;

    if (shouldShowIntro({ completed: true, replay })) {
      setShowIntro(true);
      return () => {
        mounted = false;
      };
    }

    getOnboardingCompleted().then((completed) => {
      if (mounted) setShowIntro(shouldShowIntro({ completed, replay }));
    });

    return () => {
      mounted = false;
    };
  }, [replay]);

  const completeIntro = useCallback(() => {
    if (!completionRef.current) {
      completionRef.current = setOnboardingCompleted()
        .catch(() => {
          console.error('Unable to persist onboarding completion.');
        })
        .then(() => {
          router.replace('/(main)');
        });
    }
    return completionRef.current;
  }, [router]);

  if (showIntro === null) return null;
  if (!showIntro) return <Redirect href="/(main)" />;

  return <IntroScreen onComplete={completeIntro} />;
}
