// T-138 (AD-028): LiDAR room scan with Apple RoomPlan.
//
// scanRoom() presents RoomPlan's capture UI full screen; when the user taps
// Done, the processed CapturedRoom is serialised to plain geometry in METRES
// (walls, doors/windows/openings, floors) — the shape packages/shared
// room-scan.ts parses. No quantities are computed here: the server does
// that (AD-024: code computes, and one implementation is the source of truth).
//
// T-193: each wall and opening also carries its two ends on the floor plane
// (so a floor plan can be drawn), the room its ceiling height, and the room's
// 3D model is exported with RoomPlan's own USDZ export into the app's
// documents (`modelUri`, `modelSizeBytes`). A failed export leaves the model
// out; the geometry is returned either way.
//
// T-194: no Quick Look and no AR. openPage() shows a page (the web's 3D
// viewer) in Safari's in-app browser, so the app shows the same viewer as the
// dashboard with no 3D library of its own.

import ExpoModulesCore
import RoomPlan
import SafariServices
import UIKit

public class RoomScanModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RoomScan")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.0, *) {
        return RoomCaptureSession.isSupported
      }
      return false
    }

    AsyncFunction("scanRoom") { (promise: Promise) in
      guard #available(iOS 16.0, *), RoomCaptureSession.isSupported else {
        promise.reject("ERR_UNSUPPORTED", "This device has no LiDAR scanner")
        return
      }
      DispatchQueue.main.async {
        guard let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.reject("ERR_NO_VIEW", "Nothing to present the scanner from")
          return
        }
        let scanner = RoomScanViewController { result in
          switch result {
          case .success(let room): promise.resolve(room)
          case .failure(let error): promise.reject("ERR_SCAN", error.localizedDescription)
          }
        }
        scanner.modalPresentationStyle = .fullScreen
        presenter.present(scanner, animated: true)
      }
    }.runOnQueue(.main)

    // T-194: a page in Safari's in-app browser (the 3D viewer at /room-model). Only https.
    AsyncFunction("openPage") { (address: String, promise: Promise) in
      guard let url = URL(string: address), url.scheme == "https" || url.host == "localhost" else {
        promise.reject("ERR_ADDRESS", "This address is not valid")
        return
      }
      DispatchQueue.main.async {
        guard let presenter = PagePresenter.topController() else {
          promise.reject("ERR_NO_VIEW", "Nothing to present the page from")
          return
        }
        let page = SFSafariViewController(url: url)
        page.dismissButtonStyle = .close
        presenter.present(page, animated: true) { promise.resolve(nil) }
      }
    }

    // T-193: remove a model file the app no longer needs (never throws)
    Function("removeModel") { (uri: String) in
      if let url = URL(string: uri), url.isFileURL {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }
}

/// T-194: the controller a page is shown over
enum PagePresenter {
  static func topController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    var top = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}

struct ScanCancelled: LocalizedError {
  var errorDescription: String? { "Scan cancelled" }
}

@available(iOS 16.0, *)
final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate {
  private var captureView: RoomCaptureView!
  private let completion: (Result<[String: Any], Error>) -> Void
  private var finished = false

  init(completion: @escaping (Result<[String: Any], Error>) -> Void) {
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    captureView = RoomCaptureView(frame: view.bounds)
    captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    captureView.delegate = self
    view.addSubview(captureView)

    let done = UIButton(type: .system)
    done.setTitle("Done", for: .normal)
    done.titleLabel?.font = .boldSystemFont(ofSize: 18)
    done.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.titleLabel?.font = .systemFont(ofSize: 18)
    cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
    for button in [done, cancel] {
      button.tintColor = .white
      button.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(button)
    }
    NSLayoutConstraint.activate([
      done.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
      done.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
      cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
      cancel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
  }

  @objc private func doneTapped() {
    // Stopping triggers processing; the result arrives in captureView(didPresent:)
    captureView.captureSession.stop()
  }

  @objc private func cancelTapped() {
    captureView.captureSession.stop()
    finish(.failure(ScanCancelled()))
  }

  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    return true
  }

  func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    if let error = error {
      finish(.failure(error))
      return
    }
    var room = Self.serialize(processedResult)
    // T-193: the 3D model is written off the main thread; the scan is returned whether or not it worked
    DispatchQueue.global(qos: .userInitiated).async {
      if let model = Self.exportModel(processedResult) {
        room["modelUri"] = model.url.absoluteString
        room["modelSizeBytes"] = model.size
      }
      DispatchQueue.main.async { self.finish(.success(room)) }
    }
  }

  /// T-193: RoomPlan's own USDZ export, into the app's documents. Nil when it fails.
  static func exportModel(_ room: CapturedRoom) -> (url: URL, size: Int)? {
    do {
      let folder = try FileManager.default
        .url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("room-models", isDirectory: true)
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let url = folder.appendingPathComponent("\(UUID().uuidString).usdz")
      if #available(iOS 17.0, *) {
        try room.export(to: url, exportOptions: .parametric)
      } else {
        try room.export(to: url)
      }
      let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
      guard size > 0 else { return nil }
      return (url, size)
    } catch {
      return nil
    }
  }

  private func finish(_ result: Result<[String: Any], Error>) {
    guard !finished else { return }
    finished = true
    dismiss(animated: true) { self.completion(result) }
  }

  /// Plain geometry in metres. Surface dimensions: x = width, y = height.
  /// T-193: `start` and `end` are the surface's two ends on the floor plane, [x, z] in the scan's frame:
  /// its centre (the transform's translation) plus and minus half its width along its own x axis.
  static func serialize(_ room: CapturedRoom) -> [String: Any] {
    func size(_ surface: CapturedRoom.Surface, type: String? = nil) -> [String: Any] {
      var out: [String: Any] = ["widthM": Double(surface.dimensions.x), "heightM": Double(surface.dimensions.y)]
      if let type = type { out["type"] = type }
      let t = surface.transform
      let centre = SIMD3<Float>(t.columns.3.x, t.columns.3.y, t.columns.3.z)
      let axis = SIMD3<Float>(t.columns.0.x, t.columns.0.y, t.columns.0.z)
      let length = simd_length(axis)
      if length > 0.0001 && centre.x.isFinite && centre.z.isFinite {
        let half = (axis / length) * (surface.dimensions.x / 2)
        let a = centre - half
        let b = centre + half
        out["start"] = [Double(a.x), Double(a.z)]
        out["end"] = [Double(b.x), Double(b.z)]
      }
      return out
    }
    let walls = room.walls.map { size($0) }
    var openings: [[String: Any]] = []
    for door in room.doors { openings.append(size(door, type: "door")) }
    for window in room.windows { openings.append(size(window, type: "window")) }
    for opening in room.openings { openings.append(size(opening, type: "opening")) }

    var floors: [[String: Any]] = []
    if #available(iOS 17.0, *) {
      for floor in room.floors {
        // Corners in the floor's local frame, metres. NOT verified on a device
        // which two axes span the plane; the server falls back to width ×
        // length when the polygon area comes out degenerate
        let polygon = floor.polygonCorners.map { [Double($0.x), Double($0.y)] }
        floors.append([
          "polygon": polygon,
          "widthM": Double(floor.dimensions.x),
          "lengthM": Double(floor.dimensions.y),
        ])
      }
    }
    // T-193: RoomPlan's walls run floor to ceiling, so the tallest one is the ceiling's height
    let ceiling = room.walls.map { Double($0.dimensions.y) }.max() ?? 0
    var out: [String: Any] = ["walls": walls, "openings": openings, "floors": floors]
    if ceiling > 0 { out["ceilingHeightM"] = ceiling }
    return out
  }
}
