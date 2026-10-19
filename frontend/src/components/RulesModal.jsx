export default function RulesModal({ onClose }) {
  return (
    <div className="bt-modal-backdrop" onClick={onClose}>
      <div className="bt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bt-panel-head">
          📖 Luật chơi
          <button className="bt-panel-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="bt-panel-body bt-panel-scroll bt-rules">
          <section>
            <h4>🎯 Cách thắng</h4>
            <p>Bàn cờ 15×15. Ai đặt được 5 quân liên tiếp (ngang, dọc hoặc chéo) trước là thắng. X đi trước.</p>
          </section>
          <section>
            <h4>💰 Đặt cược</h4>
            <ul>
              <li>Chủ phòng chọn mức cược; người vào phòng đặt đúng mức đó.</li>
              <li>Tiền cược bị khoá trong smart contract suốt trận.</li>
              <li>Người thắng nhận 98% hũ, 2% là phí sàn. Hoà thì hoàn cược cho cả hai.</li>
              <li>Chưa có ai vào thì chủ phòng có thể huỷ và nhận lại tiền.</li>
            </ul>
          </section>
          <section>
            <h4>⏱ Thời gian</h4>
            <p>Mỗi lượt có 5 phút. Quá giờ, đối thủ có thể bấm “Nhận thắng”. Bạn cũng có thể đầu hàng bất cứ lúc nào.</p>
          </section>
          <section>
            <h4>🪙 Ví game</h4>
            <p>
              Ví game là số dư của bạn trong smart contract. Nạp từ MetaMask để chơi, tiền thưởng được cộng vào đây, rút về
              MetaMask bất cứ lúc nào. Có thể chuyển tiền cho người chơi khác bằng nickname hoặc địa chỉ ví (không mất phí).
              Mọi giao dịch đều được contract ghi lại, xem ở nút 📜.
            </p>
          </section>
          <section>
            <h4>🔒 Minh bạch</h4>
            <p>Mọi nước đi đều nằm trên blockchain và smart contract tự xác định người thắng, không ai có thể gian lận kết quả.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
