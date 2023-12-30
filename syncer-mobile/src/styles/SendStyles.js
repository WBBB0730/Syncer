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
})
