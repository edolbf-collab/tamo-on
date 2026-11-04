import XCTest
import UIKit
import WebKit
import Security
@testable import App

final class NativeStartupTests: XCTestCase {
    @MainActor
    func testSceneLaunchLoadsNativeStorageAndLogin() async throws {
        var root: UIViewController?
        for _ in 0..<100 {
            root = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
            if root != nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let controller = try XCTUnwrap(root as? TamoonViewController,
            "SceneDelegate must launch TamoonViewController, not CAPBridgeViewController")
        let webView = try XCTUnwrap(controller.webView)
        let keychainStatus = SecItemCopyMatching([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "br.app.tamoon.native-test",
            kSecAttrAccount as String: UUID().uuidString,
            kSecReturnData as String: true
        ] as CFDictionary, nil)
        XCTAssertEqual(keychainStatus, errSecItemNotFound,
            "Simulator test host must be signed for Keychain; OSStatus: \(keychainStatus)")
        var ready = false
        for _ in 0..<200 {
            ready = (try? await webView.evaluateJavaScript("Boolean(window.TamoonNative && document.querySelector('#googleLoginButton'))")) as? Bool ?? false
            if ready { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(ready, "Cold launch must reach the login screen without a native plugin error")
        let result = try await webView.callAsyncJavaScript("""
            const native = window.TamoonNative;
            if (!native?.isIOS || !window.Capacitor.isPluginAvailable('TamoonNative'))
                throw new Error('Native iOS plugin missing');
            const key = 'tamoon-native-startup-test-' + crypto.randomUUID();
            try {
                if (await native.storage.getItem(key) !== null) throw new Error('Expected empty test key');
                await native.storage.setItem(key, 'native-keychain-roundtrip');
                if (await native.storage.getItem(key) !== 'native-keychain-roundtrip') throw new Error('Keychain read mismatch');
                await native.storage.removeItem(key);
                if (await native.storage.getItem(key) !== null) throw new Error('Keychain remove failed');
                const text = document.body.innerText;
                if (text.includes('not implemented on ios') || text.includes('Falha na conexão')) throw new Error('Startup error screen');
                if (!text.includes('Continuar com Google') || !text.includes('Continuar com Apple')) throw new Error('Login buttons missing');
                return 'native-storage-and-login-ok';
            } finally { await native.storage.removeItem(key); }
            """, arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(result as? String, "native-storage-and-login-ok")
    }
}
