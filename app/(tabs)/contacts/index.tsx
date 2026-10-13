import ContactsScreen from '@/features/contacts/screens/ContactsScreen';
import { TabRootScreen } from '@/components/app/tab-root-screen';

export default function ContactsTabRoot() {
  return (
    <TabRootScreen>
      <ContactsScreen />
    </TabRootScreen>
  );
}
