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
import Connection from './screens/Connection'
import { createTheme, ThemeProvider } from '@rneui/themed'
import theme from './styles/theme'
import ConnectModal from './components/ConnectModal'
import ConnectingModal from './components/ConnectingModal'
import RefuseModal from './components/RefuseModal'
import TextModal from './components/TextModal'
import store from './store'
import { observer } from 'mobx-react'

const elementsTheme = createTheme({
  mode: 'light',
  lightColors: {
    primary: theme.brandColor,
  },
})

const Page = observer(() => (
  <View style={ styles.page }>
    { store.status === 'connected' ? <Connection /> : <Connections /> }
  </View>
))

function App() {
  return (
    <ThemeProvider theme={ elementsTheme }>
      {/*<NavigationContainer>*/ }
      <StatusBar barStyle="dark-content" backgroundColor="#fafafa" />
      <Page />
      <ConnectingModal />
      <ConnectModal />
      <RefuseModal />
      <TextModal />
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
