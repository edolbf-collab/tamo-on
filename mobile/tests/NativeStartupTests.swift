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
            if (!native.push || !window.Capacitor.isPluginAvailable('PushNotifications'))
                throw new Error('Native push plugin missing');
            const notificationStatus = await native.push.status();
            if (!['prompt', 'granted', 'denied'].includes(notificationStatus.permission))
                throw new Error('Native notification permission bridge failed');
            if (!native.badge) throw new Error('Native badge sync missing');
            const bridge = window.Capacitor.Plugins.TamoonNative;
            let rejected = false;
            try { await bridge.setBadgeCount({count:-1}); }
            catch (error) { rejected = error.message === 'Contador de avisos inválido.'; }
            if (!rejected) throw new Error('Badge bridge must reject invalid counts');
            try { await bridge.setBadgeCount({count:0}); }
            catch (error) {
                // A clean simulator may not yet authorize badges. Bridge errors are failures.
                if (error.message !== 'Não foi possível atualizar o contador de avisos.') throw error;
            }
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

        // Render production home with synthetic data, without signing into an account.
        let fixtureURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "home-fixture", withExtension: "js"))
        let fixture = try String(contentsOf: fixtureURL, encoding: .utf8)
        _ = try await webView.callAsyncJavaScript(fixture, arguments: [:], in: nil, contentWorld: .page)
        let layout = try await webView.callAsyncJavaScript("""
            const main=document.querySelector('#mainContent'), nav=document.querySelector('.bottom-nav');
            const viewport=window.visualViewport?.height || innerHeight;
            const rect=nav.getBoundingClientRect(), content=main.getBoundingClientRect();
            if(rect.bottom>viewport+1 || content.bottom>rect.top+1) throw Error('Bottom navigation is outside visible bounds');
            for(const button of document.querySelectorAll('.home-dashboard button')) {
                button.scrollIntoView({block:'nearest',behavior:'instant'});
                await new Promise(resolve=>requestAnimationFrame(resolve));
                const r=button.getBoundingClientRect(), m=main.getBoundingClientRect();
                if(r.top<m.top-1 || r.bottom>m.bottom+1) throw Error('Home control is clipped: '+button.innerText);
                if(!button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))) throw Error('Home control is covered');
            }
            if(document.body.scrollWidth>innerWidth+1) throw Error('Horizontal overflow');
            main.scrollTop=0;
            return 'home-controls-reachable';
            """, arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(layout as? String, "home-controls-reachable")
        let homeScreenshot = try await webView.takeSnapshot(configuration: nil)
        let homeAttachment = XCTAttachment(image: homeScreenshot)
        homeAttachment.name = "Home within iPhone bounds"
        homeAttachment.lifetime = .keepAlways
        add(homeAttachment)

        // Use the real home click handler, then validate the destination and the return link.
        let continuityKey = "tamoon-navigation-test-" + UUID().uuidString
        _ = try await webView.callAsyncJavaScript("await TamoonNative.storage.setItem(key,'navigation-roundtrip'); return true;",
            arguments: ["key": continuityKey], in: nil, contentWorld: .page)
        _ = try await webView.evaluateJavaScript("document.querySelector('[data-action=playing-spaces]').click(); true")
        var marketplaceReady = false
        for _ in 0..<200 {
            marketplaceReady = (try? await webView.evaluateJavaScript("Boolean(location.pathname==='/marketplace/index.html' && document.querySelector('#pilotGate') && window.TamoonMarketplacePilot && window.TamoonNative?.isIOS)")) as? Bool ?? false
            if marketplaceReady { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(marketplaceReady, "Home button must load the packaged Marketplace, not the Community SPA fallback")
        let continuity = try await webView.callAsyncJavaScript("return await TamoonNative.storage.getItem(key);",
            arguments: ["key": continuityKey], in: nil, contentWorld: .page)
        XCTAssertEqual(continuity as? String, "navigation-roundtrip")
        _ = try await webView.callAsyncJavaScript("await TamoonNative.storage.removeItem(key); return true;",
            arguments: ["key": continuityKey], in: nil, contentWorld: .page)
        _ = try await webView.evaluateJavaScript("document.querySelector('#pilotGate a').click(); true")
        var returned = false
        for _ in 0..<200 {
            returned = (try? await webView.evaluateJavaScript("Boolean(location.pathname==='/' && document.querySelector('#googleLoginButton') && window.TamoonNative?.isIOS)")) as? Bool ?? false
            if returned { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(returned, "Return link must reopen the Community with the native bridge")
    }
}
