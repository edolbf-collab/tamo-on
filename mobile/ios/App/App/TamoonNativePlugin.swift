import Foundation
import UIKit
import AuthenticationServices
import CryptoKit
import Security
import Capacitor

@objc(TamoonViewController)
class TamoonViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TamoonNativePlugin())
    }
}

@objc(TamoonNativePlugin)
public class TamoonNativePlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "TamoonNativePlugin"
    public let jsName = "TamoonNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appleCredentialState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storageGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storageSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "storageRemove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise)
    ]
    private var appleCall: CAPPluginCall?
    private var rawNonce: String?
    private var appleState: String?
    private var authorizationController: ASAuthorizationController?
    private var webSession: ASWebAuthenticationSession?
    private let keychainService = "br.app.tamoon.auth"
    private var credentialObserver: NSObjectProtocol?

    public override func load() {
        credentialObserver = NotificationCenter.default.addObserver(forName: ASAuthorizationAppleIDProvider.credentialRevokedNotification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("appleCredentialRevoked", data: [:])
        }
    }
    deinit { if let observer = credentialObserver { NotificationCenter.default.removeObserver(observer) } }

    @objc func appleCredentialState(_ call: CAPPluginCall) {
        guard let userID = call.getString("userId"), !userID.isEmpty else { call.reject("Identidade Apple ausente."); return }
        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: userID) { state, error in
            if error != nil { call.resolve(["state": "unknown"]); return }
            call.resolve(["state": state == .authorized ? "authorized" : "revoked"])
        }
    }

    private func randomString() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw NSError(domain: "Tamoon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Não foi possível iniciar o acesso seguro."])
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    @objc func signInWithApple(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.appleCall == nil, self.webSession == nil else { call.reject("Já existe um login em andamento.", "BUSY"); return }
            do {
                let nonce = try self.randomString()
                let state = try self.randomString()
                self.appleCall = call; self.rawNonce = nonce; self.appleState = state
                let request = ASAuthorizationAppleIDProvider().createRequest()
                request.requestedScopes = [.fullName, .email]
                request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
                request.state = state
                let controller = ASAuthorizationController(authorizationRequests: [request])
                controller.delegate = self; controller.presentationContextProvider = self
                self.authorizationController = controller
                controller.performRequests()
            } catch { call.reject("Não foi possível iniciar o acesso Apple.") }
        }
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = appleCall else { return }
        defer { appleCall = nil; rawNonce = nil; appleState = nil; authorizationController = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              credential.state == appleState,
              let codeData = credential.authorizationCode,
              let code = String(data: codeData, encoding: .utf8), let nonce = rawNonce else {
            call.reject("A Apple não retornou a confirmação esperada."); return
        }
        let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) } ?? ""
        call.resolve(["code": code, "nonce": nonce, "name": name])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as NSError).code == ASAuthorizationError.canceled.rawValue
        appleCall?.reject(cancelled ? "Login cancelado." : "Não foi possível entrar com Apple.", cancelled ? "CANCELLED" : "APPLE_LOGIN_FAILED")
        appleCall = nil; rawNonce = nil; appleState = nil; authorizationController = nil
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let text = call.getString("url"), let url = URL(string: text),
              url.scheme == "https", url.user == nil, url.password == nil else { call.reject("Endereço de autenticação inválido."); return }
        let supabaseLogin = url.host == "xvwgrpnioaqyijhzqxqh.supabase.co" && url.path == "/auth/v1/authorize"
        // linkIdentity returns the provider URL after its authenticated request to Supabase.
        let googleLink = url.host == "accounts.google.com" && ["/o/oauth2/v2/auth", "/o/oauth2/auth"].contains(url.path)
        guard supabaseLogin || googleLink else { call.reject("Endereço de autenticação inválido."); return }
        DispatchQueue.main.async {
            guard self.webSession == nil, self.appleCall == nil else { call.reject("Já existe um login em andamento.", "BUSY"); return }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "br.app.tamoon") { result, error in
                self.webSession = nil
                if let url = result, url.scheme == "br.app.tamoon", url.host == "auth", url.path == "/callback" {
                    call.resolve(["url": url.absoluteString])
                } else if (error as NSError?)?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                    call.reject("Login cancelado.", "CANCELLED")
                } else { call.reject("Não foi possível concluir a autenticação.") }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.webSession = session
            if !session.start() { self.webSession = nil; call.reject("Não foi possível abrir o acesso seguro.") }
        }
    }

    private func anchor() -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window { return window }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }.first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor() }
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor() }

    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), !key.isEmpty, key.count < 256 else { call.reject("Chave de sessão inválida."); return nil }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: key]
    }
    @objc func storageGet(_ call: CAPPluginCall) {
        guard var q = query(call) else { return }
        q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve([:]); return }
        guard status == errSecSuccess, let data = result as? Data, let text = String(data: data, encoding: .utf8) else { call.reject("Não foi possível ler a sessão segura."); return }
        call.resolve(["value": text])
    }
    @objc func storageSet(_ call: CAPPluginCall) {
        guard let q = query(call), let value = call.getString("value"), value.utf8.count < 262144 else { call.reject("Sessão inválida."); return }
        let data = Data(value.utf8)
        var status = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var insert = q; insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        guard status == errSecSuccess else { call.reject("Não foi possível salvar a sessão segura."); return }
        call.resolve()
    }
    @objc func storageRemove(_ call: CAPPluginCall) {
        guard let q = query(call) else { return }
        let status = SecItemDelete(q as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Não foi possível encerrar a sessão segura."); return }
        call.resolve()
    }
    @objc func openExternal(_ call: CAPPluginCall) {
        guard let text = call.getString("url"), let url = URL(string: text), let scheme = url.scheme,
              ["https", "mailto", "whatsapp"].contains(scheme) else { call.reject("Endereço inválido."); return }
        DispatchQueue.main.async { UIApplication.shared.open(url, options: [:]) { opened in
            if opened { call.resolve() } else { call.reject("Nenhum aplicativo disponível para abrir este endereço.") }
        } }
    }
    @objc func shareFile(_ call: CAPPluginCall) {
        guard let contents = call.getString("contents"), contents.utf8.count <= 10_000_000 else { call.reject("Arquivo muito grande para compartilhar."); return }
        let name = (call.getString("name") ?? "tamo-on.json").replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "-", options: .regularExpression)
        guard name.hasSuffix(".json"), name.count <= 150 else { call.reject("Nome de arquivo inválido."); return }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else { call.reject("Tela indisponível."); return }
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let file = folder.appendingPathComponent(name)
                try Data(contents.utf8).write(to: file, options: .atomic)
                let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                activity.popoverPresentationController?.sourceView = presenter.view
                activity.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                activity.completionWithItemsHandler = { _, _, _, error in
                    try? FileManager.default.removeItem(at: folder)
                    if error != nil { call.reject("Não foi possível compartilhar o arquivo.") } else { call.resolve() }
                }
                presenter.present(activity, animated: true)
            } catch { try? FileManager.default.removeItem(at: folder); call.reject("Não foi possível preparar o arquivo.") }
        }
    }
}
