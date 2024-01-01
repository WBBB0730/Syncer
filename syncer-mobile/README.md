This is a new [**React Native**](https://reactnative.cn) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

>**Note**: Make sure you have completed the [React Native - Environment Setup](https://reactnative.cn/docs/environment-setup) instructions till "Creating a new application" step, before proceeding.

## Setup
参考文档：https://reactnative.cn/docs/environment-setup

需要：Node 16、JDK 11

1. 根据参考文档配置开发环境
2. 
    ```
    npm install
    ```

## Run
需要：adb
1. 
    ```
    npm start
    ```
2. 连接手机，打开USB调试
3. 
    ```
    adb reverse tcp:8081 tcp:8081
    ```


## Build
参考文档：https://reactnative.cn/docs/signed-apk-android
1. 将 my-release-key.keystore 文件复制到项目的 android/app 目录下
2. 
   ```
   cd android
   ./gradlew assembleRelease
   ```

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.cn) - learn more about React Native.
- [Getting Started](https://reactnative.cn/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.cn/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.cn/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
