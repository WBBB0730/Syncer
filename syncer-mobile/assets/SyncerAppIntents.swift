#if canImport(AlarmKit)
import AppIntents
import SyncerAlarmKit

@available(iOS 26.0, *)
struct SyncerAppIntentsPackage: AppIntentsPackage {
  static var includedPackages: [any AppIntentsPackage.Type] {
    [SyncerAlarmKitIntentsPackage.self]
  }
}
#endif
