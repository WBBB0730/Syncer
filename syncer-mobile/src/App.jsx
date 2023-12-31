/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from 'react'
import { StatusBar, StyleSheet, View, } from 'react-native'

import './service/udpService'
import Connection from './screens/Connection'
import Send from './screens/Send'
import { createTheme, ThemeProvider } from '@rneui/themed'
import theme from './styles/theme'
import store from './store'
import { observer } from 'mobx-react'
import Modal from './components/Modal'

const elementsTheme = createTheme({
  mode: 'light',
  lightColors: {
    primary: theme.brandColor,
  },
  components: {
    Button: {
      buttonStyle: {
        borderRadius: 6,
      }
    },
    ButtonGroup: {
      containerStyle: {
        borderRadius: 6,
      }
    },
    Input: {
      containerStyle: {
        paddingVertical: 0,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderRadius: 6,
        borderColor: theme.borderColor
      },
      inputContainerStyle: {
        borderBottomWidth: 0,
      },
      errorStyle: {
        display: 'none',
      }
    }
  }
})

const Page = observer(() => (
  <View style={ styles.page }>
    { store.status === 'connected' ? <Send /> : <Connection /> }
  </View>
))

function App() {
  return (
    <ThemeProvider theme={ elementsTheme }>
      <StatusBar barStyle="dark-content" backgroundColor="#fafafa" />
      <Page />
      <Modal />
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
