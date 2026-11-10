package br.app.tamoon;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.content.FileProvider;
import androidx.core.app.NotificationManagerCompat;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "TamoonNative")
public class TamoonNativePlugin extends Plugin {
    private static final String KEY_ALIAS = "br.app.tamoon.auth.v1";
    private PluginCall authCall;
    private boolean authAway;
    private SharedPreferences preferences() { return getContext().getSharedPreferences("tamoon-secure", 0); }
    private synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }
    private String storageKey(PluginCall call) {
        String name = call.getString("key");
        if (name == null || name.isEmpty() || name.length() >= 256) throw new IllegalArgumentException();
        return name;
    }
    @PluginMethod public void storageGet(PluginCall call) {
        try {
            String name=storageKey(call), stored=preferences().getString(name,null);
            JSObject result=new JSObject();
            if (stored != null) {
                String[] pieces=stored.split(":",2);
                Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(pieces[0],Base64.NO_WRAP)));
                cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
                result.put("value",new String(cipher.doFinal(Base64.decode(pieces[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch(Exception error) { call.reject("Não foi possível ler a sessão segura."); }
    }
    @PluginMethod public void storageSet(PluginCall call) {
        try {
            String name=storageKey(call), value=call.getString("value");
            if(value==null||value.getBytes(StandardCharsets.UTF_8).length>=262144)throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key());
            cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            String stored=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
            if(!preferences().edit().putString(name,stored).commit())throw new IllegalStateException();
            call.resolve();
        } catch(Exception error) { call.reject("Não foi possível salvar a sessão segura."); }
    }
    @PluginMethod public void storageRemove(PluginCall call) {
        try { if(!preferences().edit().remove(storageKey(call)).commit())throw new IllegalStateException(); call.resolve(); }
        catch(Exception error) { call.reject("Não foi possível encerrar a sessão segura."); }
    }
    @PluginMethod public void authenticate(PluginCall call) {
        try {
            Uri uri=Uri.parse(call.getString("url", ""));
            boolean supabase="xvwgrpnioaqyijhzqxqh.supabase.co".equals(uri.getHost())&&"/auth/v1/authorize".equals(uri.getPath());
            boolean google="accounts.google.com".equals(uri.getHost())&&("/o/oauth2/v2/auth".equals(uri.getPath())||"/o/oauth2/auth".equals(uri.getPath()));
            if(!"https".equals(uri.getScheme())||uri.getUserInfo()!=null||(!supabase&&!google))throw new IllegalArgumentException();
            if(authCall!=null) { call.reject("Já existe um login em andamento.","BUSY");return; }
            authCall=call;authAway=false;
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch(Exception error) { authCall=null;call.reject("Não foi possível abrir o acesso seguro."); }
    }
    @Override protected void handleOnNewIntent(Intent intent) {
        Uri uri=intent.getData();
        if(uri!=null&&"br.app.tamoon".equals(uri.getScheme())&&"auth".equals(uri.getHost())&&"/callback".equals(uri.getPath())&&authCall!=null) {
            PluginCall pending=authCall;authCall=null;JSObject result=new JSObject();result.put("url",uri.toString());pending.resolve(result);
        }
    }
    @Override protected void handleOnPause() { if(authCall!=null)authAway=true; }
    @Override protected void handleOnResume() {
        if(authCall!=null&&authAway) {
            PluginCall pending=authCall;
            new Handler(Looper.getMainLooper()).postDelayed(()->{
                if(authCall==pending){authCall=null;pending.reject("Login cancelado.","CANCELLED");}
            },750);
        }
    }
    @PluginMethod public void notificationStatus(PluginCall call) {
        boolean enabled=NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        if(Build.VERSION.SDK_INT>=26) {
            NotificationChannel channel=getContext().getSystemService(NotificationManager.class).getNotificationChannel("tamoon-alerts");
            if(channel!=null&&channel.getImportance()==NotificationManager.IMPORTANCE_NONE)enabled=false;
        }
        JSObject result=new JSObject();result.put("enabled",enabled);call.resolve(result);
    }
    @PluginMethod public void openExternal(PluginCall call) {
        try {
            Uri uri=Uri.parse(call.getString("url", ""));String scheme=uri.getScheme();
            if(!"https".equals(scheme)&&!"mailto".equals(scheme)&&!"whatsapp".equals(scheme))throw new IllegalArgumentException();
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW,uri));call.resolve();
        } catch(Exception error) { call.reject("Nenhum aplicativo disponível para abrir este endereço."); }
    }
    @PluginMethod public void shareFile(PluginCall call) {
        try {
            String contents=call.getString("contents", ""), name=call.getString("name", "tamo-on.json").replaceAll("[^A-Za-z0-9._-]","-");
            if(contents.getBytes(StandardCharsets.UTF_8).length>10000000||!name.endsWith(".json")||name.length()>150)throw new IllegalArgumentException();
            File folder=new File(getContext().getCacheDir(),"exports");folder.mkdirs();
            File[] old=folder.listFiles();if(old!=null)for(File file:old)file.delete();
            File file=new File(folder,name);
            try(java.io.FileOutputStream stream=new java.io.FileOutputStream(file)){stream.write(contents.getBytes(StandardCharsets.UTF_8));}
            Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
            Intent send=new Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send,"Compartilhar arquivo"));call.resolve();
        } catch(Exception error) { call.reject("Não foi possível compartilhar o arquivo."); }
    }
}
