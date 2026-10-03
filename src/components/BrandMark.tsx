export default function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="شعار مدير التعبئة" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="13" fill="#12382f" />
      <path d="M10 19.5 23.8 12l14.1 7.5v14L24 41l-14-7.5v-14Z" fill="#2daa7a" />
      <path d="m10 19.5 14 7.8 13.9-7.8M24 27.3V41M16.3 16l13.9 7.7v7.1" fill="none" stroke="#f5f7f4" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="m23.8 12 6.4 3.4v7.2" fill="none" stroke="#d5ae56" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}
