import { Overlay } from '@rneui/themed';
import React, { ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import theme from '../styles/theme';

type ModalOptions = {
  title?: string;
  content?: ReactNode;
  footer?: ReactNode;
};

const Modal = {
  show: (_options: ModalOptions): void => undefined,
  hide: (): void => undefined,
};

export default function GlobalModal({ children }: { children?: ReactNode }) {
  const [props, setProps] = useState<Required<ModalOptions> & { visible: boolean }>({
    visible: false,
    title: '',
    content: <></>,
    footer: <></>,
  });

  const show = ({ title = '', content = <></>, footer = <></> }: ModalOptions) => {
    setProps({ visible: true, title, content, footer });
  };

  const hide = () => {
    setProps({ ...props, visible: false });
  };

  Modal.show = show;
  Modal.hide = hide;

  return (
    <Overlay isVisible={props.visible} overlayStyle={modalStyles.modal}>
      <Text style={modalStyles.title}>{props.title}</Text>
      <ScrollView style={modalStyles.content}>{props.content}</ScrollView>
      <View style={modalStyles.footer}>{props.footer}</View>
      {children}
    </Overlay>
  );
}

const modalStyles = StyleSheet.create({
  modal: {
    display: 'flex',
    gap: 16,
    width: '80%',
    maxHeight: '80%',
    padding: 16,
    borderRadius: 8,
    backgroundColor: theme.bgColorWhite,
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
  },
} as Record<string, any>);

export { Modal, modalStyles };
