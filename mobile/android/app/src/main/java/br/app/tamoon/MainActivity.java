package br.app.tamoon;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TamoonNativePlugin.class);
        super.onCreate(savedInstanceState);
        if(Build.VERSION.SDK_INT>=26) {
            NotificationChannel channel=new NotificationChannel("tamoon-alerts","Avisos do Tâmo On",NotificationManager.IMPORTANCE_HIGH);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
}
