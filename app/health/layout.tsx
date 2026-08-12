import { redirect } from "next/navigation";

export default function HealthLayout({children}:{children:React.ReactNode}){
  void children;
  redirect("/health-v2");
}
