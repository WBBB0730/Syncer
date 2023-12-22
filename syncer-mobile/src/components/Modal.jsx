import { Overlay } from '@rneui/base'
import { Text, View, StyleSheet, ScrollView } from 'react-native'
import theme from '../styles/theme'
import { useState } from 'react'
import React from 'react'

const Modal = {}

export default ({ children }) => {
  const [props, setProps] = useState({
    visible: false,
    title: '',
    content: <></>,
    footer: <></>,
  })

  const show = ({ title = '', content = <></>, footer = <></> }) => {
    setProps({ visible: true, title, content, footer })
  }

  const hide = () => {
    setProps({ ...props, visible: false })
  }

  Modal.show = show
  Modal.hide = hide

  return (
    <Overlay isVisible={ props.visible } overlayStyle={ modalStyles.modal }>
      <Text style={ modalStyles.title }>
        { props.title }
      </Text>
      <ScrollView style={ modalStyles.content }>
        { props.content }
      </ScrollView>
      <View style={ modalStyles.footer }>
        { props.footer }
      </View>
    </Overlay>
  )
}

const modalStyles = StyleSheet.create({
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
  Modal,
  modalStyles,
}
