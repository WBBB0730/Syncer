import { ScrollView, StyleSheet, Text, View } from 'react-native'
import theme from '../styles/theme'
import React, { useState } from 'react'
import { Dialog, Overlay } from '@rneui/themed'

const Loading = {}

export default () => {
  const [props, setProps] = useState({
    visible: false,
  })

  const show = () => {
    setProps({ visible: true })
  }

  const hide = () => {
    setProps({ visible: false })
  }

  Loading.show = show
  Loading.hide = hide

  return (
    <Overlay isVisible={ props.visible } overlayStyle={ loadingStyles.overlay }>
      <Dialog.Loading loadingStyle={ loadingStyles.loading } />
    </Overlay>
  )
}

const loadingStyles = StyleSheet.create({
  overlay: {
    width: 100,
    height: 100,
    backgroundColor: '#ffffff',
    shadowColor: '#00000000',
    borderRadius: 8,
  },
  loading: {
    backgroundColor: '#00000000',
  },
  modal: {
    display: 'flex',
    gap: 16,
    width: '80%',
    maxHeight: '80%',
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    overflow: 'scroll',
  },
  title: {
    color: theme.mainTextColor,
    fontSize: 16,
    fontWeight: 'bold',
  },
  content: {
    flexShrink: 1,
    overflow: 'scroll',
  },
  footer: {
    display: 'flex',
    flexDirection: 'row',
    gap: 16,
  },
  button: {
    flexGrow: 1,
  },
  fileName: {
    whiteSpace: 'nowrap',
  }
})

export {
  Loading,
  loadingStyles,
}
