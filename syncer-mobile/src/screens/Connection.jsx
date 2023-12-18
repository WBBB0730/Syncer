import { Text, View } from 'react-native'
import { useCallback, useState } from 'react'
// import { Input, Button, ButtonGroup } from '@rneui/base'
import { Input, Button, ButtonGroup } from '@rneui/themed'
import { sendTcpData } from '../service/tcpService'
import store from '../store'

const TextView = () => {
  const [text, setText] = useState('')

  const sendText = useCallback(() => {
    if (!text)
      return
    sendTcpData({
      type: 'text',
      content: text,
    })
  }, [text])

  return (
    <View>
      <Input value={ text } multiline onChangeText={ setText } />
      <Button onPress={ sendText }>发送</Button>
    </View>
  )
}

const typeList = ['text', 'image', 'file']
export default function Connection() {
  const [type, setType] = useState('text')

  const disconnect = useCallback(() => {
    sendTcpData({
      type: 'disconnect'
    })
    store.disconnect()
  }, [])

  return (
    <View>
      <View>
        <Text>连接成功！</Text>
        <Button onPress={ disconnect }>断开连接</Button>
      </View>
      <ButtonGroup
        selectedIndex={ typeList.indexOf(type) }
        buttons={ ['发送文本', '发送图片', '发送文件'] }
        onPress={ (index) => { setType(typeList[index]) } } />
      {
        type === 'text' ? <TextView /> : null
      }
    </View>
  )
}
