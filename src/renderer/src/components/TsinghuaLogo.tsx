import iconImg from '../assets/icon.png'

export default function TsinghuaLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      src={iconImg}
      alt="learn++"
      width={size}
      height={size}
      style={{ borderRadius: 8, objectFit: 'contain' }}
    />
  )
}
