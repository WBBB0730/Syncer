import { StyleSheet } from 'react-native'
import theme from './theme'

export default StyleSheet.create({
  target: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  targetName: {
    color: theme.mainTextColor,
    fontSize: 28,
    fontWeight: 'bold',
  },
  selectType: {
    marginHorizontal: 0,
    marginBottom: 16,
  },
  sendTextTitle: {
    marginBottom: 8,
    color: theme.mainTextColor,
    fontSize: 16,
  },
  inputText: {
    marginBottom: 16,
    minHeight: 120,
    maxHeight: '60%',
  },
  sendFileTitle: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  sendFileTitleText: {
    color: theme.mainTextColor,
    fontSize: 16,
  },
  fileList: {
    maxHeight: '60%',
    marginBottom: 16,
  },
  fileListItem: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    padding: 8,
    borderTopWidth: 1,
    borderColor: theme.borderColor,
  },
  fileListItemDelete: {
    flexShrink: 0,
  },
  commandButtonWrap: {
    position: 'relative',
    height: 300,
  },
  commandButton: {
    position: 'absolute',
    display: 'flex',
    width: 48,
    height: 48,
    backgroundColor: theme.borderColor,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 48,
    borderRadius: 8,
  },
  arrowUpButton: {
    left: '50%',
    top: 100,
    transform: [{ translateX: -24 }]
  },
  arrowDownButton: {
    left: '50%',
    top: 150,
    transform: [{ translateX: -24 }]
  },
  arrowLeftButton: {
    left: '50%',
    top: 150,
    transform: [{ translateX: -74 }]
  },
  arrowRightButton: {
    left: '50%',
    top: 150,
    transform: [{ translateX: 26 }]
  },
  spaceButton: {
    left: '50%',
    top: 250,
    width: 148,
    transform: [{ translateX: -74 }]
  },
  escapeButton: {
    left: '50%',
    top: 0,
    transform: [{ translateX: -74 }]
  },
  f5Button: {
    left: '50%',
    top: 0,
    transform: [{ translateX: 26 }]
  },
})
