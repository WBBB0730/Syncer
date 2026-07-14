// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "SyncerStorage",
  platforms: [
    .iOS("16.4"),
    .macOS(.v13),
  ],
  products: [
    .library(name: "SyncerStorageCore", targets: ["SyncerStorageCore"]),
  ],
  targets: [
    .target(
      name: "SyncerStorageCore",
      path: "ios/Core"
    ),
    .testTarget(
      name: "SyncerStorageCoreTests",
      dependencies: ["SyncerStorageCore"],
      path: "ios/Tests"
    ),
  ]
)
