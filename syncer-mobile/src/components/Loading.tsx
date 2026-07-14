import { Dialog, Overlay } from '@rneui/themed';
import { observer } from 'mobx-react';
import { StyleSheet } from 'react-native';

import store from '../store';
import theme from '../styles/theme';

const Loading = observer(function Loading() {
  return (
    <Overlay isVisible={store.receivingFileTransfer} overlayStyle={styles.overlay}>
      <Dialog.Loading loadingStyle={styles.loading} />
    </Overlay>
  );
});

const styles = StyleSheet.create({
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
});

export default Loading;
