import MessagesScreen from '@/features/messages/screens/MessagesScreen';
import { TabRootScreen } from '@/components/app/tab-root-screen';

export default function MessagesTabRoot() {
  return (
    <TabRootScreen>
      <MessagesScreen />
    </TabRootScreen>
  );
}
