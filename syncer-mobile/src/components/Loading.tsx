import { Dialog, Overlay } from '@rneui/themed';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';

import theme from '../styles/theme';

const Loading: {
  show: () => void;
  hide: () => void;
} = {
  show: () => undefined,
  hide: () => undefined,
};

export default function GlobalLoading() {
  const [visible, setVisible] = useState(false);

  const show = () => {
    setVisible(true);
  };

  const hide = () => {
    setVisible(false);
  };

  Loading.show = show;
  Loading.hide = hide;

  return (
    <Overlay isVisible={visible} overlayStyle={loadingStyles.overlay}>
      <Dialog.Loading loadingStyle={loadingStyles.loading} />
    </Overlay>
  );
}

const loadingStyles = StyleSheet.create({
  overlay: {
    width: 100,
    height: 100,
    backgroundColor: theme.bgColorWhite,
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

export { Loading, loadingStyles };
