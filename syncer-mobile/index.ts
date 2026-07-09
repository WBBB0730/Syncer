import { registerRootComponent } from 'expo';

import App from './App';
import { configureNotifications } from './src/utils/notify';

import './src/service/udpService';

configureNotifications().catch(() => undefined);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
