# Only the minified debug target uses this file. AndroidJUnitRunner lives in
# a separate APK and references Kotlin classes shared with the target app.
# R8 cannot see those references when optimizing the target.
-keep class kotlin.** { *; }

# The instrumentation APK calls these Java methods to inspect the packaged
# WebView. Keep only its entry points in the debug target; release stays unchanged.
-keep class com.getcapacitor.BridgeActivity {
    public com.getcapacitor.Bridge getBridge();
}
-keep class com.getcapacitor.Bridge {
    public android.webkit.WebView getWebView();
    public com.getcapacitor.PluginHandle getPlugin(java.lang.String);
}
