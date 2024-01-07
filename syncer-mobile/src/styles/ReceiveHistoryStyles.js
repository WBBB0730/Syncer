import {Dimensions, StyleSheet} from "react-native";
import theme from "./theme";
const { height } = Dimensions.get('window')

export default StyleSheet.create({
  list: {
    display: 'flex',
    alignItems: 'center',
  },
  listItem: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgColorWhite,
  },
  itemContent: {
    display: 'flex',
    gap: 8,
    paddingBottom: 8,
    flexGrow: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.mainTextColor,
  },
  time: {
    fontSize: 12,
  },
  operation: {
    display: 'flex',
    flexDirection: 'row',
    alignItems:'center',
    marginBottom: 16,
  },
  operationRight: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto'
  },
  buttonStyle: {
    padding: 0,
    width: 64,
    height: 32,
    borderColor: theme.buttonBorderColor,
  },
  checkBox: {
    padding: 0,
    marginLeft: 0,
  },
  checkBoxTitle: {
    fontSize: 14,
    fontWeight: 'normal',
    color: theme.mainTextColor,
  },
  cancelTitleStyle: {
    color: theme.secondaryTextColor,
    fontSize: 14,
  },
  delTitleStyle: {
    fontSize: 14
  },
  listWrap: {
    height: height * 0.4,
  },
  showMore: {
    width: 100
  },
  noMore: {
    color: theme.tipTextColor,
  }
})
