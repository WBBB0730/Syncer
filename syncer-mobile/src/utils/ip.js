import NetInfo from '@react-native-community/netinfo'

async function getIpAddress() {
    const { type, details } = await NetInfo.fetch()
    return type === 'wifi' ? details.ipAddress : ''
}

export {
    getIpAddress
}
