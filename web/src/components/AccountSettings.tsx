import {useState} from "react";
import type {FormEvent} from "react";
import type {User} from "../lib/api";
import {api} from "../lib/api";

export default function AccountSettings({me,onClose,onUpdated}:{me:User;onClose:()=>void;onUpdated:(user:User)=>void}){
 const [username,setUsername]=useState(me.username);
 const [displayName,setDisplayName]=useState(me.display_name);
 const [currentPassword,setCurrentPassword]=useState("");
 const [newPassword,setNewPassword]=useState("");
 const [confirmPassword,setConfirmPassword]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 async function saveProfile(e:FormEvent){e.preventDefault();setBusy(true);setError("");setMessage("");try{const r=await api.updateAccount(username.trim(),displayName.trim());onUpdated(r.user);setMessage("Profile updated.");}catch(err){setError(err instanceof Error&&err.message==="username_taken"?"Username already taken.":"Could not update profile.");}finally{setBusy(false);}}
 async function savePassword(e:FormEvent){e.preventDefault();setError("");setMessage("");if(newPassword!==confirmPassword){setError("New passwords do not match.");return;}setBusy(true);try{await api.changePassword(currentPassword,newPassword);setCurrentPassword("");setNewPassword("");setConfirmPassword("");setMessage("Password changed successfully.");}catch(err){setError(err instanceof Error&&err.message==="current_password_incorrect"?"Current password is incorrect.":"Could not change password.");}finally{setBusy(false);}}
 return <div className="settings-backdrop" onClick={onClose}><section className="settings-card" role="dialog" aria-modal="true" aria-label="Account settings" onClick={e=>e.stopPropagation()}><header className="settings-head"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Settings</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">×</button></header><form className="settings-form" onSubmit={saveProfile}><h3>Profile</h3><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} minLength={3} maxLength={32} required/></label><label>Display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={80} required/></label><button className="sign-in" disabled={busy}>Save profile</button></form><form className="settings-form" onSubmit={savePassword}><h3>Change password</h3><label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required/></label><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/></label><button className="sign-in" disabled={busy}>Change password</button></form>{message&&<p className="settings-message">{message}</p>}{error&&<p className="form-error">{error}</p>}</section></div>;
}
