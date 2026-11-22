export async function optimizeImage(file:File):Promise<{blob:Blob;mime:string;width:number;height:number}>{
 if(file.type==="image/gif")return{blob:file,mime:file.type,width:0,height:0};
 const bitmap=await createImageBitmap(file);
 const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
 const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
 const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
 const context=canvas.getContext("2d");if(!context)throw new Error("image_processing_failed");
 context.drawImage(bitmap,0,0,width,height);bitmap.close();
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("image_processing_failed")),"image/webp",0.78));
 return{blob,mime:"image/webp",width,height};
}
export const MAX_VIDEO_BYTES=24*1024*1024;
