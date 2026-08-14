import { Redirect } from 'expo-router';
import { FEATURE_FLAGS } from '@/constants/feature-flags';
import AvatarFramesScreen from '@/features/profile/screens/AvatarFramesScreen';

export default function AvatarFramesRoute() {
  if (!FEATURE_FLAGS.avatarFrames) {
    return <Redirect href="/(tabs)/profile" />;
  }

  return <AvatarFramesScreen />;
}
