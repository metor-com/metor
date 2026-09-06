import UIKit
import Capacitor

// The app's view controller: Capacitor's, plus the app's own plugins (ADR-0017)
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MetorPushPlugin())
    }
}
