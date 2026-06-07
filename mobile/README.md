# Deal Hunter AI — Mobile App (React Native)

> Same backend, same database. Full iOS & Android support.

## Stack

- **Framework**: React Native (Expo managed workflow)
- **Navigation**: React Navigation v6
- **State**: React Context + AsyncStorage
- **HTTP**: Axios (same API client as web)
- **Maps**: `react-native-maps` (Apple Maps / Google Maps)
- **Scanner**: `expo-barcode-scanner` (UPC/QR scanning)
- **Notifications**: `expo-notifications` (push alerts)
- **Auth**: JWT stored in `expo-secure-store`

## Quick Start

```bash
npx create-expo-app DealHunterAI --template blank-typescript
cd DealHunterAI
npx expo install react-native-maps expo-barcode-scanner expo-notifications expo-secure-store @react-navigation/native @react-navigation/bottom-tabs @react-navigation/stack
npm install axios react-native-reanimated react-native-gesture-handler
```

## Folder Structure (matches web)

```
mobile/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx          ← Dashboard
│   │   ├── search.tsx         ← Search
│   │   ├── map.tsx            ← Map (react-native-maps)
│   │   ├── scanner.tsx        ← Barcode camera scanner
│   │   └── alerts.tsx         ← Alerts
│   ├── deal/[id].tsx          ← Deal detail
│   ├── login.tsx
│   └── _layout.tsx
├── components/
│   ├── DealCard.tsx
│   ├── ScoreRing.tsx
│   └── FilterBar.tsx
├── services/
│   └── api.ts                 ← Same endpoints as web
├── context/
│   └── AuthContext.tsx
└── constants/
    └── Colors.ts
```

## API Connection

Point to the same backend:

```typescript
// services/api.ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const api = axios.create({
  baseURL: 'https://your-backend.onrender.com/api',
  timeout: 10000,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
```

## Push Notifications Setup

```typescript
// Register for push notifications (Expo)
import * as Notifications from 'expo-notifications';

async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  
  const token = await Notifications.getExpoPushTokenAsync();
  // Send token to backend: POST /api/auth/push-token
  await api.post('/auth/push-token', { token: token.data, platform: Platform.OS });
}
```

## Barcode Scanner (UPC Lookup)

```typescript
// scanner.tsx
import { BarCodeScanner } from 'expo-barcode-scanner';

export default function Scanner() {
  const [scanned, setScanned] = useState(false);

  const handleBarCodeScanned = async ({ type, data }) => {
    setScanned(true);
    const result = await api.get(`/search/upc/${data}`);
    navigation.navigate('DealDetail', { deal: result.data.product });
  };

  return (
    <BarCodeScanner
      onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
      style={StyleSheet.absoluteFillObject}
    />
  );
}
```

## Map (react-native-maps)

```typescript
// map.tsx
import MapView, { Marker, Circle } from 'react-native-maps';

export default function Map() {
  return (
    <MapView style={{ flex: 1 }} customMapStyle={DARK_MAP_STYLE}>
      {stores.map(store => (
        <Marker
          key={store.id}
          coordinate={{ latitude: store.latitude, longitude: store.longitude }}
          title={store.store_name}
          description={`Score: ${store.top_score} · ${store.deal_count} deals`}
          pinColor={scoreColor(store.top_score)}
        />
      ))}
    </MapView>
  );
}
```

## EAS Build (App Store + Play Store)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure builds
eas build:configure

# Build for iOS (TestFlight)
eas build --platform ios --profile preview

# Build for Android (Play Store)
eas build --platform android --profile production

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

## App Store Requirements Checklist

- [ ] App Privacy Policy URL
- [ ] App Store Connect account
- [ ] Apple Developer Program ($99/yr)
- [ ] Screenshots for all device sizes
- [ ] App Icon (1024×1024 PNG)
- [ ] Google Play Console account ($25 one-time)
- [ ] Privacy Policy page hosted

## Deep Links (for deal notifications)

```
# iOS (apple-app-site-association)
dealhunter://deal/[id]
dealhunter://scanner
dealhunter://alerts

# Configure in app.json
"scheme": "dealhunter"
```

## Estimated Timeline

| Phase | Work | Time |
|-------|------|------|
| Setup & auth | Navigation, login, JWT storage | 2 days |
| Core screens | Dashboard, Search, DealDetail | 3 days |
| Map + Scanner | Native camera + maps | 2 days |
| Alerts + Watchlist | Notification registration | 2 days |
| Polish + testing | UI, edge cases, dark mode | 3 days |
| **Total** | **MVP mobile app** | **~2 weeks** |
