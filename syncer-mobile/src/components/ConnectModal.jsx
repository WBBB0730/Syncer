import { Button, Overlay } from '@rneui/themed'
import { Text, View } from 'react-native'
import { observer } from 'mobx-react'
import { useCallback } from 'react'
import { sendUdpData } from '../service/udpService'
import ModalParams from '../store/ModalParams'
import store from '../store'

const params = new ModalParams()


const ConnectModal = observer(() => {
  const { visible, device } = params

  const refuse = useCallback(() => {
    const { port, address } = device
    sendUdpData({ type: 'refuse' }, port, address)
    params.hide()
  }, [device])

  const accept = useCallback(async () => {
    await store.accept(device)
    params.hide()
  }, [device])

  return (
    <Overlay isVisible={ visible }>
      <Text>连接请求</Text>
      <Text>{ device ? device.name : '' } 请求与你建立连接</Text>
      <View>
        <Button onPress={ refuse }>拒绝</Button>
        <Button onPress={ accept }>接受</Button>
      </View>
    </Overlay>
  )
})

function showConnectModal(device) {
  params.show(device)
}

export default ConnectModal
export {
  showConnectModal
}
