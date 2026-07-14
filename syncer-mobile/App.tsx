import { createTheme, ThemeProvider } from '@rneui/themed';
import { observer } from 'mobx-react';
import { useEffect } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import Loading from './src/components/Loading';
import Modal from './src/components/Modal';
import Connection from './src/screens/Connection';
import Send from './src/screens/Send';
import { startNetworkStack } from './src/service/bootstrap';
import store from './src/store';
import theme from './src/styles/theme';
import { configureNotifications } from './src/utils/notify';

export default function App() {
  useEffect(() => {
    void configureNotifications().catch((error) => console.warn('Notification setup failed', error));
    void startNetworkStack().catch((error) => console.error('Network startup failed', error));
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider theme={elementsTheme}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.bgColorWhite} />
        <SafeAreaView style={styles.safeArea}>
          <Page />
        </SafeAreaView>
        <Modal />
        <Loading />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const Page = observer(() => (
  <View style={styles.page}>{store.status === 'connected' ? <Send /> : <Connection />}</View>
));

const elementsTheme = createTheme({
  mode: 'light',
  lightColors: {
    primary: theme.brandColor,
  },
  components: {
    Button: {
      buttonStyle: {
        borderRadius: 6,
      },
      titleStyle: {
        fontSize: 14,
      },
    },
    ButtonGroup: {
      containerStyle: {
        borderRadius: 6,
      },
    },
    Input: {
      containerStyle: {
        paddingVertical: 0,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderRadius: 6,
        borderColor: theme.borderColor,
      },
      inputContainerStyle: {
        borderBottomWidth: 0,
      },
      inputStyle: {
        fontSize: 14,
      },
      errorStyle: {
        display: 'none',
      },
    },
    CheckBox: {
      iconType: 'material-community',
      checkedIcon: 'checkbox-marked',
      uncheckedIcon: 'checkbox-blank-outline',
      containerStyle: {
        padding: 0,
        marginLeft: 0,
        marginRight: 0,
      },
    },
  },
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.bgColorWhite,
  },
  page: {
    flexGrow: 1,
    padding: 16,
    backgroundColor: theme.bgColorWhite,
  },
});
