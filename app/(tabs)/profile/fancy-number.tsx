import { Redirect } from 'expo-router';
import { FEATURE_FLAGS } from '@/constants/feature-flags';
import FancyNumberScreen from '@/features/profile/screens/FancyNumberScreen';

export default function FancyNumberRoute() {
  if (!FEATURE_FLAGS.fancyNumbers) {
    return <Redirect href="/(tabs)/profile" />;
  }

  return <FancyNumberScreen />;
}
