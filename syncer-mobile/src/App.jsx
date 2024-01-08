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
import Loading from './components/Loading'

export default () => {
  return (
    <ThemeProvider theme={ elementsTheme }>
      <StatusBar barStyle="dark-content" backgroundColor={ theme.bgColorWhite } />
      <Page />
      <Modal />
      <Loading />
    </ThemeProvider>
  )
}

const Page = observer(() => (
  <View style={ styles.page }>
    { store.status === 'connected' ? <Send /> : <Connection /> }
  </View>
))

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
      inputStyle: {
        fontSize: 14,
      },
      errorStyle: {
        display: 'none',
      }
    },
    CheckBox: {
      iconType: 'material-community',
      checkedIcon: 'checkbox-marked',
      uncheckedIcon: 'checkbox-blank-outline',
      containerStyle: {
        padding: 0,
        marginLeft: 0,
        marginRight: 0,
      }
    }
  }
})

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    padding: 16,
    backgroundColor: theme.bgColorWhite,
  }
})
