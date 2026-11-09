package br.app.tamoon;

import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class NativeStartupTest {
    @Rule public ActivityScenarioRule<MainActivity> activity = new ActivityScenarioRule<>(MainActivity.class);
    private String js(String expression) throws Exception {
        CountDownLatch completed=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        activity.getScenario().onActivity(a->a.getBridge().getWebView().evaluateJavascript(expression,value->{result.set(value);completed.countDown();}));
        assertTrue("JavaScript callback",completed.await(10,TimeUnit.SECONDS));return result.get();
    }
    private void until(String expression) throws Exception {
        long deadline=System.currentTimeMillis()+20000;
        do { if("true".equals(js(expression)))return;Thread.sleep(150); } while(System.currentTimeMillis()<deadline);
        fail("Packaged app did not satisfy: "+expression);
    }
    @Test public void notificationPermissionMetadataSurvivesCompilation() throws Exception {
        until("Boolean(window.TamoonNative?.push)");
        activity.getScenario().onActivity(a->{
            com.getcapacitor.PluginHandle handle=a.getBridge().getPlugin("PushNotifications");
            assertNotNull("Push plugin metadata",handle.getPluginAnnotation());
            assertEquals("receive",handle.getPluginAnnotation().permissions()[0].alias());
        });
        js("(async()=>{try{const result=await TamoonNative.push.status();document.documentElement.dataset.permissionTest=['granted','denied','prompt','prompt-with-rationale'].includes(result.permission)?'ok':'bad';}catch{document.documentElement.dataset.permissionTest='error';}})()");
        until("document.documentElement.dataset.permissionTest==='ok'");
    }
    @Test public void packagedLoginAndEncryptedBridgeWorkWithoutBrowserProvider() throws Exception {
        until("Boolean(window.TamoonNative?.isAndroid && window.TamoonNative?.push && document.getElementById('googleLoginButton'))");
        assertEquals("\"https://localhost\"",js("location.origin"));
        assertEquals("false",js("Boolean(document.getElementById('appleLoginButton'))"));
        js("(async()=>{try{await TamoonNative.storage.setItem('native-test','test-only');const value=await TamoonNative.storage.getItem('native-test');await TamoonNative.storage.removeItem('native-test');const removed=await TamoonNative.storage.getItem('native-test');document.documentElement.dataset.nativeTest=(value==='test-only'&&removed===null)?'ok':'bad';}catch{document.documentElement.dataset.nativeTest='error';}})()");
        until("document.documentElement.dataset.nativeTest==='ok'");
        assertEquals("false",js("Boolean(window.tamoonPwa?.registration)"));
    }
    @Test public void invitationIntentStaysPendingBeforeLogin() throws Exception {
        until("Boolean(window.App && document.getElementById('googleLoginButton'))");
        activity.getScenario().onActivity(a->{
            android.content.Intent invite=new android.content.Intent(android.content.Intent.ACTION_VIEW,
                android.net.Uri.parse("br.app.tamoon://invite?code=A1B2C3D4"));
            invite.setClass(a,MainActivity.class);
            invite.addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            a.startActivity(invite);
        });
        try {
            until("window.App.pendingInvite==='A1B2C3D4' && localStorage.getItem('tamoon-pending-invite')==='A1B2C3D4'");
            assertEquals("true",js("Boolean(document.getElementById('googleLoginButton'))"));
            assertEquals("false",js("Boolean(document.getElementById('joinGroupForm'))"));
        } finally {
            js("localStorage.removeItem('tamoon-pending-invite');window.App.pendingInvite=''");
        }
    }
}
