# 🟣 Circle IM

A polished, production-grade instant messaging UI built with **React Native**, **Expo Router**, and **TypeScript**. Circle IM delivers a WeChat-inspired chat experience with a custom design system, dark/light theming, and smooth native navigation — all as a standalone frontend application.

> **Note:** This is a **frontend-only** implementation. All data is currently mocked. No real-time messaging or backend services are connected.

---

## 📐 Design Goals

- **Pixel-perfect UI** — Every screen follows an 8pt grid system with consistent spacing, typography, and color tokens
- **Dark & Light Themes** — Full dual-theme support with system preference detection and manual toggle
- **Native Feel** — Built on React Native with native navigation transitions, safe area handling, and platform-adaptive components
- **Performance First** — FlatList/SectionList for all lists, memoized styles, and lazy screen loading
- **Responsive Layout** — SafeAreaView + edge insets ensure proper rendering across all device sizes and notch configurations
- **Accessibility** — Typed props, semantic component structure, and clear visual hierarchy

---

## ✨ Features (Frontend Only)

### 💬 Messaging
- Conversation list with unread count badges
- Filter tabs (All / Unread / Group / Private)
- Search bar for conversations
- Quick action menu (New Group, Add Friend, Scan, Pay)

### 🗨️ Chat
- Message bubbles with distinct sent/received styling
- Date separator pills
- Location card messages
- Online status indicators
- Read receipt checkmarks and timestamps

### 👥 Contacts
- Alphabetically sorted contact sections (A–Z)
- Quick action buttons (New Friends, Chat-only, Groups, Tags, Official Accounts)
- Avatar with initials fallback
- Search functionality

### 📰 Discover / Feed
- Post cards with author info, badges, and timestamps
- Image posts
- Like and comment counts
- Share button
- Filter tabs (Circles, My Circles, Notes)

### 👤 Profile
- User avatar, display name, and account ID
- Credit score, gift records, wallet, assistant shortcuts
- Member card with tags
- Settings menu with theme toggle
- Destructive logout action

### 🔐 Authentication
- Login screen with phone/email tab switching
- Registration flow (phone → verification code → password → nickname)
- Persistent auth state via Zustand + AsyncStorage

### 🎨 Theming
- Light, Dark, and System modes
- Persisted theme preference
- All components consume theme via `useTheme()` hook

---

## 🛠 Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | [Expo](https://expo.dev/) 55 + [React Native](https://reactnative.dev/) 0.83 |
| **Language** | TypeScript 5.9 |
| **Routing** | [Expo Router](https://docs.expo.dev/router/introduction/) (file-based) |
| **State Management** | [Zustand](https://zustand-demo.pmnd.rs/) 5.0 + React Context |
| **Persistence** | AsyncStorage |
| **Icons** | @expo/vector-icons (Ionicons) + lucide-react-native |
| **Images** | expo-image |
| **Animations** | react-native-reanimated |
| **Safe Areas** | react-native-safe-area-context |

---

## 📁 Project Structure

```
circle-im/
├── app/                          # Expo Router pages (file-based routing)
│   ├── index.tsx                 # Root — auth redirect logic
│   ├── _layout.tsx               # App shell with ThemeProvider
│   ├── (tabs)/                   # Bottom tab navigation
│   │   ├── messages/             # Conversation list
│   │   ├── contacts/             # Contact directory
│   │   ├── discover/             # Social feed
│   │   └── profile/              # User profile & settings
│   ├── (auth)/                   # Auth stack
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (chat)/                   # Chat stack (modal presentation)
│   │   ├── chat-detail.tsx       # Conversation view
│   │   └── chat-info.tsx         # Chat settings
│   └── (social)/                 # Social features stack
│       ├── add-friend.tsx
│       └── create-post.tsx
│
├── src/
│   ├── components/ui/            # Reusable base components
│   │   ├── avatar.tsx            # Avatar with initials fallback
│   │   ├── auth-input.tsx        # Auth form input
│   │   ├── badge.tsx             # Notification badge
│   │   ├── search-bar.tsx        # Search input
│   │   ├── filter-tabs.tsx       # Horizontal tab selector
│   │   ├── menu-row.tsx          # Settings menu item
│   │   ├── nav-header.tsx        # Navigation header
│   │   ├── icon-circle.tsx       # Icon in colored circle
│   │   └── divider.tsx           # Line separator
│   │
│   ├── features/                 # Feature modules
│   │   ├── auth/screens/         # Login, Register
│   │   ├── messages/screens/     # Conversation list
│   │   ├── chat/screens/         # Chat detail, Chat info
│   │   ├── chat/components/      # Chat bubbles, date pills
│   │   ├── contacts/screens/     # Contact directory
│   │   ├── discover/screens/     # Social feed
│   │   ├── discover/components/  # Post card
│   │   ├── profile/screens/      # Profile & settings
│   │   └── social/screens/       # Add friend, Create post
│   │
│   ├── theme/                    # Design system
│   │   ├── colors.ts             # Dark & light color palettes
│   │   ├── tokens.ts             # Spacing, typography, radii
│   │   ├── types.ts              # Theme type definitions
│   │   └── provider.tsx          # ThemeProvider + useTheme hook
│   │
│   ├── stores/                   # Zustand state stores
│   │   └── authStore.ts          # Auth state + persistence
│   │
│   ├── hooks/                    # Custom React hooks
│   │   └── use-auth.ts           # Auth operations
│   │
│   ├── services/api/             # API client setup
│   │   └── client.ts             # Generic fetch wrapper
│   │
│   ├── types/                    # TypeScript interfaces
│   │   └── index.ts
│   │
│   └── constants/                # App configuration
│       └── config.ts             # API URL, app name, limits
│
├── assets/images/                # App icons, splash screen
├── app.json                      # Expo configuration
├── tsconfig.json                 # TypeScript config (@ → ./src)
└── package.json
```

---

## 🏗 UI Architecture

### Component Hierarchy

```
ThemeProvider
└── RootLayout (_layout.tsx)
    ├── (auth) Stack
    │   ├── LoginScreen
    │   └── RegisterScreen
    ├── (tabs) TabNavigator
    │   ├── MessagesScreen
    │   ├── ContactsScreen
    │   ├── DiscoverScreen
    │   └── ProfileScreen
    ├── (chat) Stack
    │   ├── ChatDetailScreen
    │   └── ChatInfoScreen
    └── (social) Stack
        ├── AddFriendScreen
        └── CreatePostScreen
```

### State Flow

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Zustand     │────▶│  useAuth()   │────▶│  Screens     │
│  authStore   │     │  hook        │     │  & Components│
└─────────────┘     └──────────────┘     └──────────────┘

┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  ThemeCtx    │────▶│  useTheme()  │────▶│  All UI      │
│  (Context)   │     │  hook        │     │  Components  │
└─────────────┘     └──────────────┘     └──────────────┘
```

### Separation of Concerns

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Pages** | `app/` | Route definitions, minimal wrapper logic |
| **Screens** | `src/features/*/screens/` | Screen layout, data wiring, FlatList rendering |
| **Components** | `src/components/ui/` | Reusable, stateless UI primitives |
| **Feature Components** | `src/features/*/components/` | Domain-specific UI (chat bubbles, post cards) |
| **Hooks** | `src/hooks/` | Business logic, side effects |
| **Stores** | `src/stores/` | Global state with Zustand |
| **Theme** | `src/theme/` | Design tokens, color palettes, theme provider |

---

## 📱 Screens / UI Sections

### Sidebar — Conversation List
The Messages tab displays a scrollable list of conversations with avatars, last message preview, timestamps, and unread badges. Filter tabs allow switching between All, Unread, Group, and Private views. A floating "+" button opens a quick actions dropdown.

### Chat Window
The Chat Detail screen renders messages in a FlatList with sent messages (indigo bubbles, right-aligned) and received messages (surface-colored bubbles, left-aligned). Date separator pills divide conversations by day. A location card component supports rich message types.

### Message Input
The chat input bar sits at the bottom with a text input, voice button, emoji button, and send/more action button. The input area respects safe area insets for devices with home indicators.

### Header / Navigation
Each screen uses a custom `NavHeader` component with a back button, centered title, and optional right action icon. The tab bar is a floating, rounded bar positioned at the bottom with icon + label for each of the 4 main sections.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- iOS Simulator (macOS) or Android Emulator

### Installation

```bash
# Clone the repository
git clone https://github.com/yiboding/circle-im.git
cd circle-im

# Install dependencies
npx expo install

# Start the development server
npx expo start
```

### Running on Device/Simulator

```bash
# iOS
npx expo run:ios

# Android
npx expo run:android

# Web
npx expo start --web
```

---

## 📝 Development Notes

### Coding Conventions

- **Functional components only** — no class components
- **All props are typed** — TypeScript interfaces, no `any`
- **StyleSheet.create()** for all styles — zero inline styles
- **useMemo** for style objects that depend on theme colors
- **FlatList / SectionList** for all scrollable lists — never `ScrollView` + `.map()`

### Component Patterns

- Base UI components live in `src/components/ui/` and are exported via barrel `index.ts`
- Feature screens live in `src/features/<feature>/screens/`
- Feature-specific components live in `src/features/<feature>/components/`
- Each feature module has its own `index.ts` barrel export

### Styling Approach

- **8pt grid system** — all spacing uses multiples of 4 or 8 (`xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48`)
- **Design tokens** centralized in `src/theme/` — colors, spacing, typography, border radius
- **Theme-aware styles** — components call `useTheme()` and create styles with `useMemo`
- **Dark & Light palettes** — primary color (indigo `#6366F1`) remains consistent across themes

### Language

All UI labels are in **Chinese (Simplified)**. Localization infrastructure is not yet in place.

---

## 🚧 Planned (Not Implemented Yet)

These features are part of the project roadmap but have **not been built**:

- **OpenIM Integration** — Connect to [OpenIM](https://www.openim.io/) server for real-time messaging
- **Real-time Messaging** — WebSocket-based message delivery and presence
- **Backend API Connection** — Replace mock data with live API endpoints
- **Push Notifications** — Message and activity notifications via Expo Notifications
- **Media Sharing** — Send and receive images, videos, and files in chat
- **Voice & Video Calls** — Real-time audio/video communication
- **Group Chat Management** — Create, invite, manage group conversations
- **i18n / Localization** — Multi-language support beyond Chinese
- **End-to-End Encryption** — Message encryption for private conversations
- **Search** — Full-text search across messages and contacts

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feat/amazing-feature`)
3. **Commit** your changes (`git commit -m 'feat: add amazing feature'`)
4. **Push** to your branch (`git push origin feat/amazing-feature`)
5. **Open** a Pull Request

### Guidelines

- Follow the existing code style and conventions
- Use TypeScript — no `any` types
- Add components to the appropriate feature module
- Use design tokens from `src/theme/` — don't hardcode colors or spacing
- Write meaningful commit messages using [Conventional Commits](https://www.conventionalcommits.org/)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built with Expo + React Native + TypeScript
</p>
