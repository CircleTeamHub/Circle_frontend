import { Redirect } from 'expo-router';
import { FEATURE_FLAGS } from '@/constants/feature-flags';
import AvatarFrameDetailScreen from '@/features/profile/screens/AvatarFrameDetailScreen';

export default function AvatarFrameDetailRoute() {
  if (!FEATURE_FLAGS.avatarFrames) {
    return <Redirect href="/(tabs)/profile" />;
  }

  return <AvatarFrameDetailScreen />;
}
