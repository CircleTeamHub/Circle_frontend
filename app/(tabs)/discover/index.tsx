import CirclePlazaScreen from '@/features/discover/screens/CirclePlazaScreen';
import { TabRootScreen } from '@/components/app/tab-root-screen';

export default function DiscoverTabRoot() {
  return (
    <TabRootScreen>
      <CirclePlazaScreen />
    </TabRootScreen>
  );
}
