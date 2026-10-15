"""Build a small synthetic playback test; no customer data or presenter footage."""
import sys, pathlib, math, subprocess
from PIL import Image, ImageDraw, ImageFont
root=pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'private/video-runtime'))
import imageio_ffmpeg
out=root.parent/'public/v/erster-flow'
out.mkdir(parents=True,exist_ok=True)
font=lambda n,b=False:ImageFont.truetype('C:/Windows/Fonts/segoeui'+('b' if b else '')+'.ttf',n)
scenes=[('Energie sichtbar machen.','Eine persönliche Analyse beginnt mit einem klaren Blick.', ['Verbrauch verstehen','Potenziale erkennen','Nächsten Schritt planen']),('Von der Analyse zum Gespräch.','Die wichtigsten Punkte. In einem kurzen Video.', ['Persönliche Landingpage','Video direkt im Browser','Klare nächste Aktion']),('Ihr nächster Schritt.','Gemeinsam prüfen, was für Ihr Unternehmen sinnvoll ist.', ['Analyse ansehen','Fragen sammeln','Gespräch vorbereiten'])]
cmd=[imageio_ffmpeg.get_ffmpeg_exe(),'-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r','24','-i','-','-an','-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'testvideo.mp4')]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=subprocess.DEVNULL)
for frame in range(432):
 t=frame/24;scene=min(2,int(t/6));local=t%6
 im=Image.new('RGB',(1280,720),(16,31,30));d=ImageDraw.Draw(im)
 for i in range(5):
  x=880+i*90+int(math.sin(t*.5+i)*20);d.line([(x,-30),(x-240,750)],fill=(24+i*2,48+i*2,43+i*2),width=32)
 d.text((80,55),'WALKENHORST',font=font(25,True),fill='#D5AE60')
 d.text((80,99),'ENERGIE · FUNKTIONSDEMO',font=font(17),fill='#AEBEB6')
 title,subtitle,points=scenes[scene];offset=int(12*max(0,1-local*3))
 d.text((80,215+offset),title,font=font(51,True),fill='#FFFFFF')
 d.text((80,294),subtitle,font=font(23),fill='#CAD4CE')
 for i,point in enumerate(points):
  d.ellipse((83,390+i*55,94,401+i*55),fill='#D5AE60');d.text((115,377+i*55),point,font=font(26),fill='#F4F3ED')
 d.text((80,640),'Testvideo ohne Andreas und ohne Ton · Keine Kundenanalyse',font=font(18),fill='#B4BEB8')
 d.rounded_rectangle((80,690,1200,695),radius=2,fill='#304B42');d.rounded_rectangle((80,690,80+int(1120*frame/431),695),radius=2,fill='#D5AE60')
 p.stdin.write(im.tobytes())
 if frame==48:im.save(root/'private/demo-poster.jpg');im.save(out/'poster.jpg')
p.stdin.close()
if p.wait()!=0:raise RuntimeError('Video encoding failed')
print('Synthetic demo MP4 generated:',(out/'testvideo.mp4').stat().st_size,'bytes; 18 seconds')
