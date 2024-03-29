import { StyleSheet } from 'react-native'
import theme from './theme'
import colors from './colors'

export default StyleSheet.create({
  target: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
  },
  targetName: {
    maxWidth: 240,
    color: theme.mainTextColor,
    fontSize: 24,
    fontWeight: 'bold',
  },
  whiteList: {
    marginBottom: 16,
  },
  selectType: {
    marginHorizontal: 0,
    marginBottom: 16,
  },
  sendTextTitle: {
    marginBottom: 8,
    color: theme.mainTextColor,
    fontSize: 14,
  },
  inputText: {
    marginBottom: 14,
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
    fontSize: 14,
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
  fileListItemName: {
    width: 0,
    flexGrow: 1,
  },
  fileListItemDelete: {
    flexShrink: 0,
  },
  commandButtonWrap: {
    position: 'relative',
    height: 200,
    marginTop: 16,
  },
  commandButton: {
    position: 'absolute',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.orange2,
  },
  commandButtonText: {
    color: theme.secondaryTextColor,
    fontSize: 20,
    fontWeight: 'bold',
  },
  commandButtonIcon: {
    width: 28,
    height: 28,
    opacity: 0.65,
  },
})
