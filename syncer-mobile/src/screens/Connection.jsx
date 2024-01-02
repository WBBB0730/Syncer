import { useEffect, useState } from 'react'
import store from '../store'
import { sendUdpData } from '../service/udpService'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { Button, Overlay } from '@rneui/themed'
import { observer } from 'mobx-react'
import styles from '../styles/ConnectionStyles'
import Icon from 'react-native-vector-icons/AntDesign'
import theme from '../styles/theme'
import { getIpAddress } from '../utils/ip'
import sleep from '../utils/sleep'
import { Modal, modalStyles } from '../components/Modal'

export default () => {
  return (
    <>
      <MyDeviceName />
      <MyDeviceIp />
      <AvailableTitle />
      <AvailableDevices />
      <ConnectingModal />
    </>
  )
}

const MyDeviceName = observer(() => {
  const [editingName, setEditingName] = useState(false)
  const [inputName, setInputName] = useState('')

  function editName() {
    setEditingName(true)
    setInputName(store.name)
  }

  function cancelEditName() {
    setEditingName(false)
  }

  function saveName() {
    if (!inputName)
      return
    store.setName(inputName)
    setEditingName(false)
  }

  return (
    <View style={ styles.myDeviceName }>
      {
        editingName ? (
          <>
            <View>
              <TextInput value={ inputName } style={ styles.inputName } placeholder="请输入设备名称"
                         onChangeText={ setInputName } />
            </View>
            <Button type="clear" icon={ <Icon name="close" size={ 20 } color={ theme.brandColor } /> }
                    onPress={ cancelEditName } />
            <Button type="clear" icon={ <Icon name="check" size={ 20 } color={ theme.brandColor } /> }
                    onPress={ saveName } />
          </>
        ) : (
          <>
            <Text style={ styles.myDeviceNameText }>{ store.name }</Text>
            <Button type="clear" icon={ <Icon name="edit" size={ 20 } color={ theme.brandColor } /> }
                    onPress={ editName } />
          </>
        )
      }
    </View>
  )
})

const MyDeviceIp = () => {
  const [ipAddress, setIpAddress] = useState('')
  useEffect(() => {
    getIpAddress().then(setIpAddress)
  }, [])

  return (
    <Text style={ styles.myIpAddress }>{ ipAddress }</Text>
  )
}

const AvailableTitle = () => {
  const [searching, setSearching] = useState(false)
  const [inputIpAddress, setInputIpAddress] = useState('')
  const [flag, setFlag] = useState(false)

  useEffect(() => {
    search()
  }, [])

  useEffect(() => {
    if (flag) {
      search()
      setFlag(false)
    }
  }, [flag])

  /** 查找同一局域网内的设备 */
  async function search(test) {
    const ipAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(inputIpAddress) && inputIpAddress
    store.clearAvailableDeviceMap()

    setSearching(true)
    for (let i = 0; i < 5; i++) {
      sendUdpData({ type: 'search' }, 5742, '255.255.255.255')
      if (ipAddress)
        sendUdpData({ type: 'search' }, 5742, ipAddress)
      await sleep(500)
    }
    setSearching(false)
  }

  function manualSearch() {
    Modal.show({
      title: '手动查找',
      content: (
        <InputIpAddress inputIpAddress={ inputIpAddress } setInputIpAddress={ setInputIpAddress } />
      ),
      footer: (
        <>
          <Button type="outline" containerStyle={ { flexGrow: 1 } } onPress={ Modal.hide }>取消</Button>
          <Button containerStyle={ { flexGrow: 1 } } onPress={ () => {
            Modal.hide()
            setFlag(true)
          } }>确定</Button>
        </>
      ),
    })
  }

  return (
    <View style={ styles.availableTitle }>
      <Text style={ styles.availableTitleText }>可用设备</Text>
      <Button loading={ searching } type="outline"
              buttonStyle={ styles.searchButton } titleStyle={ styles.searchButtonText }
              onPress={ search }>查找</Button>
      <Button disabled={ searching } type="outline"
              buttonStyle={ styles.manualSearchButton } titleStyle={ styles.searchButtonText }
              onPress={ manualSearch }>手动查找</Button>
    </View>
  )
}

const InputIpAddress = ({ inputIpAddress = '', setInputIpAddress }) => {
  const [value, setValue] = useState(inputIpAddress)
  useEffect(() => {
    setInputIpAddress(value)
  }, [value])
  return (
    <TextInput value={ value } style={ styles.inputIpAddress } onChangeText={ setValue } />
  )
}

const AvailableDevices = observer(() => {
  return (
    <ScrollView style={ styles.availableDevices }>
      {
        Array.from(store.availableDeviceMap.values()).map(device => (
          <View key={ device.uuid } style={ styles.availableDevice }>
            <Icon name={ device.device === 'desktop' ? 'iconfontdesktop' :
              device.device === 'mobile' ? 'mobile1' : 'question' } size={ 32 } color={ theme.mainTextColor } />
            <View style={ styles.availableDeviceInfo }>
              <Text style={ styles.availableDeviceName }>{ device.name }</Text>
              <Text style={ styles.availableDeviceAddress }>{ device.address }</Text>
            </View>
            <Button buttonStyle={ styles.connectButton } titleStyle={ styles.connectButtonText }
                    onPress={ () => store.connect(device) }>连接</Button>
          </View>
        ))
      }
      <Text style={ styles.tip }>请确保设备已连接至同一个 Wi-Fi 网络</Text>
    </ScrollView>
  )
})

const ConnectingModal = observer(() => {
  return (
    <Overlay isVisible={ store.status === 'connecting' } overlayStyle={ modalStyles.modal }>
      <Text style={ modalStyles.title }>正在连接</Text>
      <View style={ modalStyles.content }>
        <Text>等待 { store.target ? store.target.name : '' } 接受连接请求</Text>
      </View>
      <View style={ modalStyles.footer }>
        <View style={ modalStyles.button }>
          <Button type="outline" onPress={ () => { store.cancel() } }>取消</Button>
        </View>
      </View>
    </Overlay>
  )
})
