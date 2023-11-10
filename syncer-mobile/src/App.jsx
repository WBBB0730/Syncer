/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from 'react'
import { ScrollView, StatusBar, StyleSheet, View, } from 'react-native'

import './service/udpService'
import { NavigationContainer } from '@react-navigation/native'
import Connections from './screens/Connections'
import { createTheme, ThemeProvider } from '@rneui/themed'
import theme from './styles/theme'
import ConnectModal from './components/ConnectModal'
import ConnectingModal from './components/ConnectingModal'
import RefuseModal from './components/RefuseModal'

const elementsTheme = createTheme({
  mode: 'light',
  lightColors: {
    primary: theme.brandColor,
  },
})

function App() {
  return (
    <ThemeProvider theme={ elementsTheme }>
      {/*<NavigationContainer>*/ }
      <StatusBar barStyle="dark-content" backgroundColor="#fafafa" />
      <View style={ styles.page }>
        <Connections />
      </View>
      {/*<Modal />*/}
      <ConnectingModal />
      <ConnectModal />
      <RefuseModal />
      {/*</NavigationContainer>*/ }
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  app: {
    color: 'red'
  },
  page: {
    padding: 16
  }
})

export default App
