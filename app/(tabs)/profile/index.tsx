import ProfileScreen from '@/features/profile/screens/ProfileScreen';
import { TabRootScreen } from '@/components/app/tab-root-screen';

export default function ProfileTabRoot() {
  return (
    <TabRootScreen>
      <ProfileScreen />
    </TabRootScreen>
  );
}
