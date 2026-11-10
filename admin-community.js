(function(){
'use strict';const app=window.App;if(!app)return;const diagnostics=app.openPlatformAdmin;app.openPlatformDiagnostics=diagnostics;
app.openPlatformAdmin=function(){if(!this.state.is_platform_admin)return this.toast('Acesso restrito à administração.',true);this.adminOperations?.dispose();
this.modal('Administração','<div class="admin-toolbar"><button class="btn btn-secondary" data-admin-diagnostics>Saúde e suporte</button><button class="btn btn-secondary" data-admin-moderation>Denúncias</button></div><div id="communityAdminOperations"></div>',root=>{
root.querySelector('[data-admin-diagnostics]').onclick=()=>{this.adminOperations?.dispose();diagnostics.call(this);};
root.querySelector('[data-admin-moderation]').onclick=()=>{this.adminOperations?.dispose();this.openSafetyCenter('admin');};
this.adminOperations=window.TamoonAdminOperations.mount(root.querySelector('#communityAdminOperations'),{mode:'community',identity:()=>this.state.is_platform_admin?this.state.profile?.id||'':'',rpc:async(name,args)=>{const r=await this.repo.client.rpc(name,args);if(r.error)throw r.error;return r.data;}});
});};})();
